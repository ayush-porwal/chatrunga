import { afterEach, describe, expect, it, vi } from "vitest";
import { START_FEN } from "@chaturanga/shared/chess/position";
import type { BroadcastLiveGame, BroadcastMove } from "@chaturanga/shared/types/broadcast";
import { watchBoardSounds } from "../../app/useMoveSounds";
import { useBroadcastStore } from "../../stores/broadcast-store";
import { useGameStore } from "../../stores/game-store";
import {
  applyLiveGame,
  backToLive,
  broadcastSession,
  followBoard,
  followedCopy,
  followLiveMoves,
  isFollowedBoard,
  undoBackToLive,
  type BroadcastGameRef
} from "./broadcast-follow";
import { mergeLiveLine } from "./live-line";

// The moves the board sounds, by SAN.
const sounded = vi.hoisted(() => [] as string[]);
vi.mock("../../sounds/sounds", () => ({
  playMoveSound: (san: string) => sounded.push(san),
  playSound: () => undefined
}));

const REF: BroadcastGameRef = {
  tourId: "Tour0001",
  tourName: "Knight Invitational",
  roundId: "Round001",
  roundName: "Round 1",
  gameId: "Game0001"
};

const MOVES: BroadcastMove[] = [
  { uci: "e2e4", san: "e4", clock: "1:00:00" },
  { uci: "e7e5", san: "e5", clock: "0:59:00" }
];

function liveGame(moves: BroadcastMove[], result: BroadcastLiveGame["result"] = "*") {
  return {
    id: REF.gameId,
    roundId: REF.roundId,
    white: { name: "Carlsen", title: "GM", rating: 2837, federation: "NOR", fideId: null },
    black: { name: "Gukesh", title: "GM", rating: 2787, federation: "IND", fideId: null },
    initialFen: START_FEN,
    moves,
    fen: START_FEN,
    lastMove: moves.at(-1)?.uci ?? null,
    result,
    headers: { event: null, round: "1.1", date: null, timeControl: null, site: null }
  } satisfies BroadcastLiveGame;
}

/** Opens the game on the board and follows it, as the tournament page does. */
function open(game: BroadcastLiveGame) {
  const session = broadcastSession(game, REF);
  if (!session) throw new Error("no session");
  useGameStore.getState().loadGame(session);
  const merged = mergeLiveLine(session.moveTree, game.moves);
  followBoard(REF, merged?.liveIds ?? []);
}

/** The id of the board's move `san`, failing the test without one. */
function nodeId(san: string): string {
  const node = useGameStore.getState().moveTree.find((item) => item.san === san);
  if (!node) throw new Error(`no ${san} on the board`);
  return node.id;
}

const sans = () => {
  const { moveTree, currentNodeId } = useGameStore.getState();
  return moveTree.find((node) => node.id === currentNodeId)?.san;
};

describe("following a broadcast game on the board", () => {
  afterEach(() => {
    useBroadcastStore.setState({ games: {}, connections: {}, follow: null, cleared: null });
    useGameStore.getState().reset();
  });

  it("opens on the live position with the players and clocks", () => {
    open(liveGame(MOVES));
    const game = useGameStore.getState();
    expect(game.headers).toMatchObject({ white: "GM Carlsen", black: "GM Gukesh", round: "1.1" });
    expect(sans()).toBe("e5");
    expect(game.moveTree.find((node) => node.san === "e5")?.clockAfter).toBe("0:59:00");
    expect(isFollowedBoard(game.board)).toBe(true);
  });

  it("moves on with the game from the live position, and stays put elsewhere", () => {
    open(liveGame(MOVES));
    applyLiveGame(liveGame([...MOVES, { uci: "g1f3", san: "Nf3", clock: null }]));
    expect(sans()).toBe("Nf3");

    useGameStore.getState().goToNode(nodeId("e4"));
    applyLiveGame(
      liveGame([
        ...MOVES,
        { uci: "g1f3", san: "Nf3", clock: null },
        { uci: "b8c6", san: "Nc6", clock: null }
      ])
    );
    expect(sans()).toBe("e4");
    expect(useBroadcastStore.getState().follow?.liveIds).toHaveLength(5);
  });

  it("follows a line the broadcaster took back to its new live position", () => {
    open(liveGame(MOVES));
    applyLiveGame(liveGame(MOVES.slice(0, 1)));
    expect(sans()).toBe("e4");
    expect(useBroadcastStore.getState().follow?.liveIds).toHaveLength(2);
    expect(useGameStore.getState().moveTree).toHaveLength(2);
  });

  it("clears the user's moves on Back to live and puts them back on undo", () => {
    open(liveGame(MOVES));
    // The user explores 2. d4 from the live position, then the game goes 2. Nf3.
    expect(useGameStore.getState().makeUciMove("d2d4")).toBe(true);
    expect(useGameStore.getState().makeUciMove("e5d4")).toBe(true);
    applyLiveGame(liveGame([...MOVES, { uci: "g1f3", san: "Nf3", clock: null }]));
    expect(sans()).toBe("exd4");

    expect(backToLive()).toBe(2);
    expect(sans()).toBe("Nf3");
    expect(useGameStore.getState().moveTree).toHaveLength(4);

    undoBackToLive();
    expect(useGameStore.getState().moveTree).toHaveLength(6);
    expect(useBroadcastStore.getState().cleared).toBeNull();
  });

  it("copies the board for the library as a game of its own, the user's moves included", () => {
    open(liveGame(MOVES));
    expect(useGameStore.getState().makeUciMove("g1f3")).toBe(true);
    const copy = followedCopy();
    expect(copy).toMatchObject({ source: "pgn-import", headers: { white: "GM Carlsen" } });
    expect(copy?.moveTree).toHaveLength(4);
    expect(copy?.pgn).toContain("2. Nf3");
    expect(copy?.id).not.toBe(useGameStore.getState().gameId);
  });

  it("records the result once the game ends, and stops with another board", () => {
    open(liveGame(MOVES));
    applyLiveGame(liveGame(MOVES, "1-0"));
    expect(useGameStore.getState().headers.result).toBe("1-0");
    // A result the broadcaster corrects back to a game in progress.
    applyLiveGame(liveGame(MOVES));
    expect(useGameStore.getState().headers.result).toBe("*");

    useGameStore.getState().reset();
    expect(isFollowedBoard(useGameStore.getState().board)).toBe(false);
  });

  it("moves the board only while followed, catching up silently when followed again", () => {
    const NF3: BroadcastMove = { uci: "g1f3", san: "Nf3", clock: null };
    const NC6: BroadcastMove = { uci: "b8c6", san: "Nc6", clock: null };
    const BB5: BroadcastMove = { uci: "f1b5", san: "Bb5", clock: null };
    const A6: BroadcastMove = { uci: "a7a6", san: "a6", clock: null };
    const BA4: BroadcastMove = { uci: "b5a4", san: "Ba4", clock: null };
    open(liveGame(MOVES));
    const stopSounds = watchBoardSounds();
    sounded.length = 0;
    try {
      // The round's stream, watched, first sends the game as it stands; then its new moves.
      let stopFollowing = followLiveMoves();
      useBroadcastStore.getState().receiveGame(liveGame(MOVES));
      useBroadcastStore.getState().receiveGame(liveGame([...MOVES, NF3]));
      expect(sans()).toBe("Nf3");
      expect(sounded).toStrictEqual(["Nf3"]);

      // Another page: the game goes on, the board (and its sound) doesn't.
      stopFollowing();
      useBroadcastStore.getState().receiveGame(liveGame([...MOVES, NF3, NC6]));
      expect(sans()).toBe("Nf3");
      expect(useGameStore.getState().moveTree).toHaveLength(4);
      expect(sounded).toStrictEqual(["Nf3"]);

      // Back on the board: the move played meanwhile is put in without a sound, then it follows.
      stopFollowing = followLiveMoves();
      expect(sans()).toBe("Nc6");
      expect(sounded).toStrictEqual(["Nf3"]);
      useBroadcastStore.getState().receiveGame(liveGame([...MOVES, NF3, NC6]));
      useBroadcastStore.getState().receiveGame(liveGame([...MOVES, NF3, NC6, BB5]));
      expect(sans()).toBe("Bb5");
      expect(sounded).toStrictEqual(["Nf3", "Bb5"]);

      // Away with nothing streaming the round: back, its reopened stream's first sending brings
      // the move played meanwhile, silently too; the next one sounds.
      stopFollowing();
      stopFollowing = followLiveMoves();
      useBroadcastStore.getState().receiveGame(liveGame([...MOVES, NF3, NC6, BB5, A6]));
      expect(sans()).toBe("a6");
      expect(sounded).toStrictEqual(["Nf3", "Bb5"]);
      useBroadcastStore.getState().receiveGame(liveGame([...MOVES, NF3, NC6, BB5, A6, BA4]));
      expect(sans()).toBe("Ba4");
      expect(sounded).toStrictEqual(["Nf3", "Bb5", "Ba4"]);
      stopFollowing();
    } finally {
      stopSounds();
    }
  });
});
