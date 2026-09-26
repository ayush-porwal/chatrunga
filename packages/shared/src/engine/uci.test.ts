import { describe, expect, it } from "vitest";
import { parseBestMove, parseInfoLine, parseLc0MoveStat } from "./uci";

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
    expect(parseBestMove("engine-1", "bestmove e2e4 ponder e7e5")).toEqual({
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

  it("parses lc0 VerboseMoveStats lines (real lc0 0.32 / Maia output)", () => {
    expect(
      parseLc0MoveStat(
        "info string f1c4  (139 ) N:       0 (+ 0) (P: 23.75%) (WL:  -.-----) (D: -.---) (M:  -.-) (Q:  0.03315) (U: 0.41444) (S:  0.44759) (V:  -.----) "
      )
    ).toEqual({ move: "f1c4", n: 0, p: 0.2375, v: null, q: 0.03315, wl: null, d: null });
    expect(
      parseLc0MoveStat(
        "info string node  (  27) N:       1 (+ 0) (P:  0.00%) (WL:  0.03162) (D: 0.039) (M:  0.0) (Q:  0.03162) (V:  0.0331) "
      )
    ).toEqual({ move: "node", n: 1, p: 0, v: 0.0331, q: 0.03162, wl: 0.03162, d: 0.039 });
    expect(parseLc0MoveStat("info string Using backend metal")).toBeNull();
    expect(parseLc0MoveStat("info depth 1 seldepth 1 score cp 80 pv f1c4")).toBeNull();
  });
});
