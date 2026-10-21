import { describe, expect, it } from "vitest";
import { parseBestMove, parseInfoLine } from "./uci";

describe("shared UCI parser", () => {
  it("parses engine info lines", () => {
    expect(
      parseInfoLine("engine-1", "info depth 12 multipv 2 score cp -41 nodes 10 nps 20 pv d2d4 g8f6")
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
    expect(parseBestMove("engine-1", "bestmove e2e4 ponder e7e5")).toStrictEqual({
      engineId: "engine-1",
      move: "e2e4",
      ponder: "e7e5"
    });
    expect(parseBestMove("engine-1", "bestmove (none)")).toBeNull();
  });

  it("parses UCI_ShowWDL output (real Stockfish line)", () => {
    const info = parseInfoLine(
      "sf",
      "info depth 10 seldepth 13 multipv 1 score cp 38 wdl 79 917 4 nodes 21594 nps 599833 hashfull 2 tbhits 0 time 36 pv f1b5 g8e7"
    );
    expect(info).toMatchObject({
      seldepth: 13,
      wdl: { win: 79, draw: 917, loss: 4 },
      score: { type: "cp", value: 38 }
    });
    expect(parseInfoLine("sf", "info depth 0 score mate 0")).toMatchObject({
      score: { type: "mate", value: 0 }
    });
  });
});
