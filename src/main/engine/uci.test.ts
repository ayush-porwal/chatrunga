import { describe, expect, it } from "vitest";
import { parseBestMove, parseInfoLine } from "./uci";

describe("UCI parser", () => {
  it("parses centipawn info lines", () => {
    const info = parseInfoLine("engine-1", "info depth 12 seldepth 18 score cp 34 nodes 1200 nps 90000 pv e2e4 e7e5");
    expect(info).toMatchObject({
      engineId: "engine-1",
      depth: 12,
      seldepth: 18,
      nodes: 1200,
      nps: 90000,
      score: { type: "cp", value: 34 },
      pv: ["e2e4", "e7e5"]
    });
  });

  it("parses mate score lines", () => {
    const info = parseInfoLine("engine-1", "info depth 8 score mate -2 pv h2h4");
    expect(info?.score).toEqual({ type: "mate", value: -2 });
  });

  it("parses bestmove lines", () => {
    expect(parseBestMove("engine-1", "bestmove e2e4 ponder e7e5")).toEqual({
      engineId: "engine-1",
      move: "e2e4",
      ponder: "e7e5"
    });
  });
});
