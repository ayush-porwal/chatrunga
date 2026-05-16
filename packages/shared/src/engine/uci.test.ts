import { describe, expect, it } from "vitest";
import { parseBestMove, parseInfoLine } from "./uci";

describe("shared UCI parser", () => {
  it("parses engine info lines", () => {
    expect(
      parseInfoLine(
        "engine-1",
        "info depth 12 multipv 2 score cp -41 nodes 10 nps 20 pv d2d4 g8f6"
      )
    ).toMatchObject({
      engineId: "engine-1",
      depth: 12,
      multipv: 2,
      nodes: 10,
      nps: 20,
      score: { type: "cp", value: -41 },
      pv: ["d2d4", "g8f6"]
    });
    expect(parseInfoLine("engine-1", "readyok")).toBeNull();
  });

  it("parses best moves and ignores empty best moves", () => {
    expect(parseBestMove("engine-1", "bestmove e2e4 ponder e7e5")).toEqual({
      engineId: "engine-1",
      move: "e2e4",
      ponder: "e7e5"
    });
    expect(parseBestMove("engine-1", "bestmove (none)")).toBeNull();
  });
});
