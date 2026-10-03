import { beforeEach, describe, expect, it } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import { mainlineReviewInput } from "../features/game-review/review-utils";
import { useGameStore } from "./game-store";
import { compatibleReviewMoves, lineStillOnMainline } from "./review-validity";

/** The reviewed moves of the board's main line, as a finished review holds them. */
function reviewOfMainline(): MoveReview[] {
  return mainlineReviewInput(useGameStore.getState().moveTree).map((move) => ({
    nodeId: move.nodeId,
    ply: move.ply,
    san: move.san,
    playedMove: move.uci,
    fenBefore: move.fenBefore,
    fenAfter: move.fenAfter
  }) as MoveReview);
}

function nodeBySan(san: string): MoveNode {
  const node = useGameStore.getState().moveTree.find((item) => item.san === san);
  if (!node) throw new Error(`no ${san}`);
  return node;
}

const tree = () => useGameStore.getState().moveTree;

describe("review validity", () => {
  beforeEach(() => {
    const { game } = importPgnText("1. e4 (1. d4 d5) e5 *");
    useGameStore.getState().loadGame({ ...game, id: "g" });
  });

  it("keeps every move (the same array) while the analysed line is unchanged", () => {
    const moves = reviewOfMainline();
    useGameStore.getState().goToNode("root");
    useGameStore.getState().goToNode(nodeBySan("d5").id);
    expect(compatibleReviewMoves(moves, tree())).toBe(moves);
  });

  it("drops reviewed moves whose line was deleted", () => {
    const moves = reviewOfMainline();
    useGameStore.getState().deleteLineFromNode(nodeBySan("e5").id);
    expect(compatibleReviewMoves(moves, tree()).map((move) => move.san)).toEqual(["e4"]);
  });

  it("drops reviewed moves moved off the main line (a variation takes their place)", () => {
    const moves = reviewOfMainline();
    useGameStore.getState().deleteLineFromNode(nodeBySan("e4").id);
    // d4 d5 is the main line now; nothing of the analysis describes it.
    expect(compatibleReviewMoves(moves, tree())).toEqual([]);
  });

  it("drops a reviewed move replaced by another one", () => {
    const moves = reviewOfMainline();
    useGameStore.getState().deleteLineFromNode(nodeBySan("e5").id);
    useGameStore.getState().goToNode(nodeBySan("e4").id);
    useGameStore.getState().makeUciMove("d7d6");
    expect(compatibleReviewMoves(moves, tree()).map((move) => move.san)).toEqual(["e4"]);
  });

  it("keeps the analysis of a line that was extended or got a new variation", () => {
    const moves = reviewOfMainline();
    useGameStore.getState().goToNode(nodeBySan("e5").id);
    useGameStore.getState().makeUciMove("g1f3");
    useGameStore.getState().goToNode(nodeBySan("e4").id);
    useGameStore.getState().makeUciMove("c7c5");
    expect(compatibleReviewMoves(moves, tree())).toBe(moves);
  });

  it("tells whether a running review's line is still the start of the main line", () => {
    const line = mainlineReviewInput(tree()).map((move) => ({ nodeId: move.nodeId, uci: move.uci }));
    useGameStore.getState().goToNode(nodeBySan("e5").id);
    useGameStore.getState().makeUciMove("g1f3");
    expect(lineStillOnMainline(line, tree())).toBe(true);
    useGameStore.getState().deleteLineFromNode(nodeBySan("e5").id);
    expect(lineStillOnMainline(line, tree())).toBe(false);
  });
});
