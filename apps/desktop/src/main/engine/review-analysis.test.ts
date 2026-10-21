import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AnalysisLine, EngineInfo } from "@chaturanga/shared/types/engine";
import { parseInfoLine } from "@chaturanga/shared/engine/uci";
import {
  computeEvalLoss,
  linesFromInfoStream,
  tacticalMotifsForBestMove,
  terminalScore
} from "./review-analysis";

const ITALIAN = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";

function fixture(name: string): string[] {
  return readFileSync(join(__dirname, "__fixtures__", name), "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
}

function line(multipv: number, cp: number, pv: string[], mate = false): AnalysisLine {
  const score = { type: mate ? ("mate" as const) : ("cp" as const), value: cp };
  return { multipv, depth: 12, score, scoreWhite: score, pv };
}

describe("linesFromInfoStream", () => {
  it("keeps the final line per multipv with depth, WDL and nodes (real Stockfish output)", () => {
    const infos = fixture("stockfish-wdl-italian.txt")
      .map((raw) => parseInfoLine("sf", raw))
      .filter((info): info is EngineInfo => Boolean(info));
    const lines = linesFromInfoStream(ITALIAN, infos);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({
      multipv: 1,
      depth: 10,
      seldepth: 13,
      nodes: 21594,
      score: { type: "cp", value: 38 },
      wdl: { win: 79, draw: 917, loss: 4 }
    });
    expect(lines[1].pv[0]).toBe("d2d4");
  });

  it("skips bound lines and converts to White perspective", () => {
    const blackToMove = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    const infos = [
      parseInfoLine("sf", "info depth 8 multipv 1 score cp 20 nodes 1 pv e7e5")!,
      parseInfoLine("sf", "info depth 9 multipv 1 score cp 90 lowerbound nodes 2 pv c7c5")!
    ];
    const [only] = linesFromInfoStream(blackToMove, infos);
    expect(only.pv[0]).toBe("e7e5");
    expect(only.scoreWhite).toStrictEqual({ type: "cp", value: -20 });
  });
});

describe("computeEvalLoss", () => {
  const top = [line(1, 80, ["e2e4"]), line(2, 30, ["d2d4"]), line(3, -40, ["g1f3"])];

  it("uses the same-search score when the played move is in MultiPV", () => {
    // After-search disagrees (+10 for opponent → -10 mover) but must be ignored.
    expect(
      computeEvalLoss({
        topLines: top,
        playedRank: 2,
        afterScore: { type: "cp", value: 10 },
        terminal: null
      })
    ).toBe(50);
  });

  it("falls back to the after-search for moves outside MultiPV", () => {
    expect(
      computeEvalLoss({
        topLines: top,
        playedRank: null,
        afterScore: { type: "cp", value: 220 },
        terminal: null
      })
    ).toBe(300);
  });

  it("gives a small loss for a slower mate instead of 0", () => {
    const mates = [line(1, 2, ["a1a8"], true), line(2, 5, ["b1b8"], true)];
    const loss = computeEvalLoss({
      topLines: mates,
      playedRank: 2,
      afterScore: null,
      terminal: null
    });
    expect(loss).toBeGreaterThan(0);
    expect(loss).toBeLessThanOrEqual(35);
  });

  it("treats delivering mate as zero loss and stalemating a winning position as a big loss", () => {
    expect(
      computeEvalLoss({
        topLines: top,
        playedRank: null,
        afterScore: terminalScore("checkmate"),
        terminal: "checkmate"
      })
    ).toBe(0);
    const winning = [line(1, 900, ["a1a8"])];
    expect(
      computeEvalLoss({
        topLines: winning,
        playedRank: null,
        afterScore: terminalScore("stalemate"),
        terminal: "stalemate"
      })
    ).toBe(900);
  });
});

describe("tacticalMotifsForBestMove", () => {
  it("does not call a plain capture or check a tactic", () => {
    // 1.e4 d5: exd5 is a capture of a defended pawn — not a tactic.
    const fen = "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    expect(tacticalMotifsForBestMove(fen, "e4d5", { type: "cp", value: 30 })).toStrictEqual([]);
  });

  it("does not call a recapture on the last move's square 'hanging'", () => {
    // Black just played ...Bxf3; Qxf3 retakes the (undefended) bishop.
    const fen = "rn1qkbnr/ppp2ppp/3p4/4P3/4P3/5b2/PPP2PPP/RNBQKB1R w KQkq - 0 5";
    expect(tacticalMotifsForBestMove(fen, "d1f3", { type: "cp", value: 60 }, "g4f3")).not.toContain(
      "hanging"
    );
    expect(tacticalMotifsForBestMove(fen, "d1f3", { type: "cp", value: 60 }, null)).toContain(
      "hanging"
    );
  });

  it("detects a knight fork created by the best move", () => {
    // Nc7+ forks king (e8) and rook (a8).
    const fen = "r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1";
    expect(tacticalMotifsForBestMove(fen, "b5c7", { type: "cp", value: 500 })).toContain("fork");
  });

  it("detects winning a hanging piece and mates", () => {
    const hanging = "4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1";
    expect(tacticalMotifsForBestMove(hanging, "d1d5", { type: "cp", value: 900 })).toContain(
      "hanging"
    );
    const backRank = "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1";
    expect(tacticalMotifsForBestMove(backRank, "d1d8", { type: "mate", value: 1 })).toContain(
      "checkmate"
    );
  });
});
