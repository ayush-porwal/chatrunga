import { describe, expect, it } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import { followGameMoves } from "./scratch-moves";
import { scratchAnalysisTarget } from "./review-scratch-analysis";

describe("scratchAnalysisTarget", () => {
  it("searches the scratch position through the game's moves and the line's, castling as the king's move", () => {
    const { game } = importPgnText("1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 *");
    const nf6 = game.moveTree.find((node) => node.san === "Nf6")!;
    const followed = followGameMoves(game.moveTree, nf6.id, ["O-O", "Bc5", "d3"])!;
    const line = {
      originNodeId: nf6.id,
      anchorNodeId: followed.node.id,
      moves: followed.rest,
      index: 1
    };
    const target = scratchAnalysisTarget(game.moveTree, game.rootFen, line);
    expect(target).toStrictEqual({
      owner: "review-scratch",
      nodeId: nf6.id,
      rootFen: game.rootFen,
      moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "e1g1", "f8c5"],
      fen: followed.rest[1].fenAfter
    });
    expect(
      scratchAnalysisTarget(game.moveTree, game.rootFen, { ...line, anchorNodeId: "x" })
    ).toBeNull();
  });
});
