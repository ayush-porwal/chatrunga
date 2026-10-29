import { describe, expect, it } from "vitest";
import type {
  ImportPreview,
  ImportPreviewGame,
  ImportSelection
} from "@chaturanga/shared/types/repertoire";
import { importStats, suggestedColor, suggestedName } from "./import-inference";

function game(index: number, patch: Partial<ImportPreviewGame> = {}): ImportPreviewGame {
  return {
    index,
    proposedTitle: `Game ${index + 1}`,
    rootFen: "start",
    headers: {},
    nodeCount: 10,
    tree: [],
    decisions: { white: 4, black: 3 },
    warnings: [],
    invalidBranches: [],
    ...patch
  };
}

const selection = (gameIndex: number, patch: Partial<ImportSelection> = {}): ImportSelection => ({
  gameIndex,
  title: "",
  kind: "opening",
  include: true,
  ...patch
});

describe("import inference", () => {
  it("names a new repertoire after its most common opening family", () => {
    expect(
      suggestedName([
        game(0, { opening: { name: "Caro-Kann Defense: Advance Variation", eco: "B12" } }),
        game(1, { opening: { name: "Sicilian Defense", eco: "B20" } }),
        game(2, { opening: { name: "Caro-Kann Defense", eco: "B10" } }),
        game(3)
      ])
    ).toBe("Caro-Kann Defense");
    expect(suggestedName([game(0)])).toBe("");
  });

  it("takes the colour from the Orientation tag, else the side that branches less", () => {
    expect(suggestedColor([game(0, { headers: { Orientation: "black" } })])).toBe("black");
    expect(suggestedColor([game(0, { branching: { white: 5, black: 0 } }), game(1)])).toBe("black");
    expect(suggestedColor([game(0, { branching: { white: 0, black: 4 } })])).toBe("white");
  });

  it("counts new moves, moves to practise and positions with several of your moves", () => {
    const preview: ImportPreview = {
      jobId: "j",
      games: [game(0), game(1), game(2, { nodeCount: 5 })],
      multiMovePositions: {
        white: [
          {
            positionKey: "k1",
            moves: [
              { uci: "e2e4", san: "e4", games: [0] },
              { uci: "d2d4", san: "d4", games: [1] }
            ]
          },
          {
            positionKey: "k2",
            moves: [
              { uci: "g1f3", san: "Nf3", games: [0] },
              { uci: "c2c4", san: "c4", games: [2] }
            ]
          }
        ],
        black: []
      }
    };
    const selections = [
      selection(0),
      selection(1, { kind: "reference" }),
      selection(2, { include: false })
    ];
    expect(importStats(preview, selections, "white")).toStrictEqual({
      newMoves: 20,
      practiceMoves: 4,
      severalMoves: 1,
      severalMovesGames: [0, 1]
    });
    expect(importStats(preview, selections, "black").severalMoves).toBe(0);
  });
});
