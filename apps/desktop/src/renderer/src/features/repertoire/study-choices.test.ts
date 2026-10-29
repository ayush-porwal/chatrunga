import { describe, expect, it } from "vitest";
import { START_FEN } from "@chaturanga/shared/chess/position";
import type { RepertoireHealthFlag } from "@chaturanga/shared/types/repertoire-health";
import { DASHED_GREEN_BRUSH } from "../board/board-shapes";
import { positionChoices, repertoireArrows } from "./study-choices";

const flag: RepertoireHealthFlag = {
  repertoireId: "r1",
  positionKey: "k0",
  fen: START_FEN,
  kind: "engine-disagrees",
  uci: "g1f3",
  san: "Nf3",
  bestUci: "e2e4",
  bestSan: "e4",
  loss: 11,
  probability: null,
  rating: null,
  line: "",
  chapterId: "c1",
  nodeId: "root",
  revision: 3,
  checkedAt: 0
};

describe("the choices at a position, across the repertoire", () => {
  const choices = () =>
    positionChoices({
      fen: START_FEN,
      positionKey: "k0",
      preferredUci: "e2e4",
      flags: [flag, { ...flag, positionKey: "other", uci: "e2e4" }],
      sources: [
        {
          chapterId: "c1",
          chapterTitle: "Main",
          nodeId: "root",
          moves: [
            { nodeId: "a", uci: "g1f3", san: "Nf3", kind: "yours" },
            { nodeId: "b", uci: "b1c3", san: "Nc3", kind: "reference" }
          ]
        },
        {
          chapterId: "c2",
          chapterTitle: "Sidelines",
          nodeId: "x",
          moves: [
            { nodeId: "c", uci: "e2e4", san: "e4", kind: "yours" },
            { nodeId: "d", uci: "b1c3", san: "Nc3", kind: "yours" },
            { nodeId: "e", uci: "g1f3", san: "Nf3", kind: "yours" }
          ]
        }
      ]
    });

  it("merges a move's chapters and keeps its strongest kind, the preferred move first", () => {
    expect(
      choices().map((row) => [row.label, row.kind, row.preferred, row.chapters, row.at.nodeId])
    ).toStrictEqual([
      ["1.e4", "yours", true, ["Sidelines"], "c"],
      ["1.Nf3", "yours", false, ["Main", "Sidelines"], "a"],
      ["1.Nc3", "yours", false, ["Main", "Sidelines"], "b"]
    ]);
  });

  it("puts the health check's flags on their move at this position only", () => {
    const rows = choices();
    expect(rows.find((row) => row.uci === "g1f3")!.flags).toStrictEqual([flag]);
    expect(rows.find((row) => row.uci === "e2e4")!.flags).toStrictEqual([]);
  });

  it("orders covered replies before study-only ones, and prefers none of them", () => {
    const rows = positionChoices({
      fen: START_FEN,
      positionKey: null,
      preferredUci: "d2d4",
      flags: [],
      sources: [
        {
          chapterId: "c1",
          chapterTitle: "Main",
          nodeId: "root",
          moves: [
            { nodeId: "a", uci: "c2c4", san: "c4", kind: "reference" },
            { nodeId: "b", uci: "d2d4", san: "d4", kind: "covered" }
          ]
        }
      ]
    });
    expect(rows.map((row) => [row.uci, row.preferred])).toStrictEqual([
      ["d2d4", false],
      ["c2c4", false]
    ]);
  });
});

describe("repertoire arrows", () => {
  it("draws your moves green (the preferred one solid), covered replies blue, study-only none", () => {
    const base = { label: "", chapters: [], at: { chapterId: "c1", nodeId: "n" }, flags: [] };
    expect(
      repertoireArrows([
        { ...base, uci: "e2e4", kind: "yours", preferred: true },
        { ...base, uci: "d2d4", kind: "yours", preferred: false },
        { ...base, uci: "c2c4", kind: "covered", preferred: false },
        { ...base, uci: "g1f3", kind: "reference", preferred: false }
      ])
    ).toStrictEqual([
      { orig: "e2", dest: "e4", brush: "green" },
      { orig: "d2", dest: "d4", brush: DASHED_GREEN_BRUSH },
      { orig: "c2", dest: "c4", brush: "blue" }
    ]);
  });
});
