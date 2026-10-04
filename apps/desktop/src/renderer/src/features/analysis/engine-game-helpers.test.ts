import { describe, expect, it } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import { currentLineUcis } from "./engine-game-helpers";
import type { MoveNode } from "@chaturanga/shared/types/chess";

function node(input: Partial<MoveNode> & Pick<MoveNode, "id" | "parentId">): MoveNode {
  return {
    san: null,
    uci: null,
    fenBefore: "before",
    fenAfter: "after",
    ply: 0,
    nags: [],
    comment: null,
    arrows: [],
    highlights: [],
    children: [],
    ...input
  };
}

describe("currentLineUcis", () => {
  it("returns the UCI moves from root to the selected node", () => {
    const tree = [
      node({ id: "root", parentId: null, children: ["a"] }),
      node({ id: "a", parentId: "root", uci: "e2e4", children: ["b"] }),
      node({ id: "b", parentId: "a", uci: "e7e5", children: ["c"] }),
      node({ id: "c", parentId: "b", uci: "g1f3" })
    ];

    expect(currentLineUcis(tree, "c")).toEqual(["e2e4", "e7e5", "g1f3"]);
  });

  it("returns an empty line for unknown nodes", () => {
    expect(currentLineUcis([node({ id: "root", parentId: null })], "missing")).toEqual([]);
  });

  it("sends an imported game's castling as the king's move, which Stockfish accepts", () => {
    // A PGN stores castling as chessops writes it, the king taking its rook (e1h1, e8a8).
    const { game } = importPgnText(
      "1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. O-O Be7 5. d3 d6 6. Nc3 Bg4 7. h3 Qd7 8. hxg4 O-O-O *"
    );
    expect(game.moveTree.map((item) => item.uci)).toContain("e1h1");

    expect(currentLineUcis(game.moveTree, game.currentNodeId)).toEqual([
      "e2e4",
      "e7e5",
      "g1f3",
      "b8c6",
      "f1c4",
      "g8f6",
      "e1g1",
      "f8e7",
      "d2d3",
      "d7d6",
      "b1c3",
      "c8g4",
      "h2h3",
      "d8d7",
      "h3g4",
      "e8c8"
    ]);
  });

  it("keeps a rook's move from e1 to h1 as it is", () => {
    const { game } = importPgnText(`[SetUp "1"]
[FEN "6k1/8/8/8/8/8/8/K3R3 w - - 0 1"]

1. Rh1 *`);

    expect(currentLineUcis(game.moveTree, game.currentNodeId)).toEqual(["e1h1"]);
  });
});
