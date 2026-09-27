import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChaturangaApi } from "@chaturanga/shared/ipc/chaturanga-api";
import type { LichessEvent, LichessGameFull, LichessGameState, LichessStatus } from "@chaturanga/shared/types/lichess";
import { mainlineUcis, useGameStore } from "../stores/game-store";
import { useLichessStore } from "../stores/lichess-store";
import { startLichessSync } from "./useLichess";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const status: LichessStatus = {
  account: { id: "ayush", username: "Ayush", title: null, perfs: {}, connectedAt: 1, lastSyncAt: null },
  connecting: false,
  tokenRejected: false
};

function state(moves: string[], patch: Partial<LichessGameState> = {}): LichessGameState {
  return { moves, wtime: 600_000, btime: 600_000, winc: 0, binc: 0, status: "started", winner: null, drawOffer: null, ...patch };
}

function full(moves: string[] = []): LichessGameFull {
  return {
    id: "game1",
    variant: "standard",
    rated: true,
    speed: "rapid",
    clock: { initialMs: 600_000, incrementMs: 0 },
    white: { id: "ayush", name: "Ayush", rating: 1840, title: null, aiLevel: null },
    black: { id: "rival", name: "rival", rating: 1850, title: null, aiLevel: null },
    initialFen: START,
    state: state(moves),
    createdAt: 0
  };
}

/** A fake bridge: records calls, lets the test push events. */
function fakeBridge() {
  let emit: (event: LichessEvent) => void = () => undefined;
  const api = {
    status: vi.fn(async () => status),
    challenges: vi.fn(async () => []),
    ongoingGames: vi.fn(async () => []),
    syncGames: vi.fn(async () => ({ imported: 0, skipped: 0 })),
    watchGame: vi.fn(async () => undefined),
    unwatchGame: vi.fn(async () => undefined),
    move: vi.fn(async () => undefined)
  };
  const events = {
    onLichessEvent: (callback: (event: LichessEvent) => void) => {
      emit = callback;
      return () => undefined;
    }
  };
  return { api, events, emit: (event: LichessEvent) => emit(event) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("startLichessSync", () => {
  let bridge: ReturnType<typeof fakeBridge>;
  let stop: () => void;
  const openGame = vi.fn((load: () => void) => load());

  beforeEach(async () => {
    useGameStore.getState().reset();
    useGameStore.getState().setMode("freeplay");
    useLichessStore.setState({ live: null, seek: null, challenges: [], ongoingGameIds: [] });
    openGame.mockClear();
    bridge = fakeBridge();
    stop = startLichessSync({
      api: bridge.api as unknown as ChaturangaApi["lichess"],
      events: bridge.events,
      openGame,
      refreshGames: () => undefined
    });
    await flush();
  });

  afterEach(() => stop());

  async function startGame(moves: string[] = []) {
    bridge.emit({ type: "gameStart", gameId: "game1" });
    expect(bridge.api.watchGame).toHaveBeenCalledWith("game1");
    bridge.emit({ type: "gameFull", game: full(moves) });
    await flush();
  }

  it("reads the account and imports new games at start", () => {
    expect(useLichessStore.getState().status.account?.username).toBe("Ayush");
    expect(bridge.api.syncGames).toHaveBeenCalledOnce();
  });

  it("puts a starting game on the board as an online match from your side", async () => {
    await startGame();
    const board = useGameStore.getState();
    expect(openGame).toHaveBeenCalledOnce();
    expect(board.mode).toBe("online");
    expect(board.source).toBe("lichess");
    expect(board.orientation).toBe("white");
    expect(board.engineSide).toBe("black");
    expect(board.headers.site).toBe("https://lichess.org/game1");
    expect(useLichessStore.getState().live).toMatchObject({ id: "game1", yourColor: "white", over: false });
  });

  it("sends your move and applies the opponent's", async () => {
    await startGame();
    expect(useGameStore.getState().makeMove({ from: "e2", to: "e4" })).toBe(true);
    expect(bridge.api.move).toHaveBeenCalledWith("game1", "e2e4");
    bridge.emit({ type: "gameState", gameId: "game1", state: state(["e2e4"]) });
    bridge.emit({ type: "gameState", gameId: "game1", state: state(["e2e4", "e7e5"]) });
    expect(mainlineUcis(useGameStore.getState().moveTree)).toEqual(["e2e4", "e7e5"]);
    expect(bridge.api.move).toHaveBeenCalledOnce();
  });

  it("keeps your move on the board while it's on its way", async () => {
    await startGame();
    useGameStore.getState().makeMove({ from: "e2", to: "e4" });
    // A state from before the move reached Lichess (e.g. a clock update) doesn't take it back.
    bridge.emit({ type: "gameState", gameId: "game1", state: state([]) });
    expect(mainlineUcis(useGameStore.getState().moveTree)).toEqual(["e2e4"]);
  });

  it("takes back a move Lichess refused and says why", async () => {
    bridge.api.move.mockRejectedValueOnce(new Error("Error invoking remote method 'lichess:move': Error: Not your turn"));
    await startGame();
    useGameStore.getState().makeMove({ from: "e2", to: "e4" });
    await flush();
    expect(mainlineUcis(useGameStore.getState().moveTree)).toEqual([]);
    expect(useGameStore.getState().matchFeedback).toBe("Not your turn");
  });

  it("ends the game with Lichess's result and stops watching", async () => {
    await startGame(["e2e4"]);
    bridge.emit({ type: "gameState", gameId: "game1", state: state(["e2e4"], { status: "resign", winner: "white" }) });
    expect(useGameStore.getState().gameOutcome).toEqual({ result: "1-0", termination: "Player resign" });
    expect(useGameStore.getState().headers.result).toBe("1-0");
    expect(useLichessStore.getState().live?.over).toBe(true);
    expect(bridge.api.unwatchGame).toHaveBeenCalledWith("game1");
  });

  it("follows a reconnect without reloading the game", async () => {
    await startGame(["e2e4"]);
    useGameStore.getState().setGameId("saved-id");
    bridge.emit({ type: "gameConnection", gameId: "game1", connected: false });
    expect(useLichessStore.getState().live?.connected).toBe(false);
    bridge.emit({ type: "gameFull", game: full(["e2e4", "e7e5"]) });
    expect(useGameStore.getState().gameId).toBe("saved-id");
    expect(mainlineUcis(useGameStore.getState().moveTree)).toEqual(["e2e4", "e7e5"]);
    expect(useLichessStore.getState().live?.connected).toBe(true);
  });

  it("keeps a second game waiting while one is being played", async () => {
    await startGame();
    bridge.emit({ type: "gameStart", gameId: "game2" });
    expect(bridge.api.watchGame).toHaveBeenCalledTimes(1);
    expect(useLichessStore.getState().ongoingGameIds).toEqual(["game2"]);
  });

  it("lets go of the board when you're signed out mid-game", async () => {
    await startGame();
    bridge.emit({ type: "status", status: { account: null, connecting: false, tokenRejected: false } });
    expect(useLichessStore.getState().live).toMatchObject({ over: true, connected: false });
    expect(useGameStore.getState().matchFeedback).toMatch(/Signed out/);
  });

  it("keeps a game that starts while another is still loading for later", () => {
    bridge.emit({ type: "gameStart", gameId: "game1" });
    bridge.emit({ type: "gameStart", gameId: "game2" });
    expect(bridge.api.watchGame).toHaveBeenCalledTimes(1);
    expect(useLichessStore.getState().ongoingGameIds).toEqual(["game2"]);
    bridge.emit({ type: "gameFull", game: full() });
    expect(useLichessStore.getState().live?.id).toBe("game1");
  });

  it("lets go of the board when another account connects mid-game", async () => {
    await startGame();
    const other = { ...status, account: { ...status.account!, id: "someone", username: "Someone" } };
    bridge.emit({ type: "status", status: other });
    expect(useLichessStore.getState().live?.over).toBe(true);
  });

  it("leaves chess variants on lichess.org", () => {
    bridge.emit({ type: "gameStart", gameId: "game1" });
    bridge.emit({ type: "gameFull", game: { ...full(), variant: "atomic" } });
    expect(useLichessStore.getState().live).toBeNull();
    expect(bridge.api.unwatchGame).toHaveBeenCalledWith("game1");
    expect(useLichessStore.getState().seekError).toMatch(/variant/);
    expect(openGame).not.toHaveBeenCalled();
  });

  it("drops a game still loading when you're signed out", () => {
    bridge.emit({ type: "gameStart", gameId: "game1" });
    bridge.emit({ type: "status", status: { account: null, connecting: false, tokenRejected: false } });
    expect(bridge.api.unwatchGame).toHaveBeenCalledWith("game1");
    bridge.emit({ type: "gameFull", game: full() });
    expect(useLichessStore.getState().live).toBeNull();
    expect(openGame).not.toHaveBeenCalled();
  });
});
