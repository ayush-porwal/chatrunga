import { beforeEach, describe, expect, it } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import { standardCastlingUci } from "@chaturanga/shared/chess/review";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import { mainlineReviewInput } from "../features/game-review/review-utils";
import { useGameStore } from "./game-store";
import { compatibleReviewMoves, lineStillOnMainline } from "./review-validity";

/**
 * The reviewed moves of the board's main line, as a finished review holds them (the review stores
 * a castle the standard way, as the main process's review does).
 */
function reviewOfMainline(): MoveReview[] {
  return mainlineReviewInput(useGameStore.getState().moveTree).map(
    (move) =>
      ({
        nodeId: move.nodeId,
        ply: move.ply,
        san: move.san,
        playedMove: standardCastlingUci(move.fenBefore, move.uci),
        fenBefore: move.fenBefore,
        fenAfter: move.fenAfter
      }) as MoveReview
  );
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

  it("keeps the analysis of imported castles, which the tree stores as king takes rook", () => {
    const { game } = importPgnText(
      "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O d6 5. d3 Be6 6. Nc3 Qd7 7. Be3 O-O-O *"
    );
    useGameStore.getState().loadGame({ ...game, id: "castles" });
    const castles = tree().filter((node) => node.san?.startsWith("O-O"));
    expect(castles.map((node) => node.uci)).toEqual(["e1h1", "e8a8"]);
    const moves = reviewOfMainline();
    expect(
      moves.filter((move) => move.san.startsWith("O-O")).map((move) => move.playedMove)
    ).toEqual(["e1g1", "e8c8"]);
    expect(compatibleReviewMoves(moves, tree())).toBe(moves);
  });

  it("tells whether a running review's line is still the start of the main line", () => {
    const line = mainlineReviewInput(tree()).map((move) => ({
      nodeId: move.nodeId,
      uci: move.uci
    }));
    useGameStore.getState().goToNode(nodeBySan("e5").id);
    useGameStore.getState().makeUciMove("g1f3");
    expect(lineStillOnMainline(line, tree())).toBe(true);
    useGameStore.getState().deleteLineFromNode(nodeBySan("e5").id);
    expect(lineStillOnMainline(line, tree())).toBe(false);
  });
});
