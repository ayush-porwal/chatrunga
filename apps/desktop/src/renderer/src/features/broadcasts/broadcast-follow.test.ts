import { afterEach, describe, expect, it } from "vitest";
import { START_FEN } from "@chaturanga/shared/chess/position";
import type { BroadcastLiveGame, BroadcastMove } from "@chaturanga/shared/types/broadcast";
import { useBroadcastStore } from "../../stores/broadcast-store";
import { useGameStore } from "../../stores/game-store";
import {
  applyLiveGame,
  backToLive,
  broadcastSession,
  followBoard,
  followedCopy,
  isFollowedBoard,
  undoBackToLive,
  type BroadcastGameRef
} from "./broadcast-follow";
import { mergeLiveLine } from "./live-line";

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
});
