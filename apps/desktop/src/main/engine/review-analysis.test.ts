import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AnalysisLine, EngineConfig, EngineInfo } from "@chaturanga/shared/types/engine";
import { parseInfoLine, parseLc0MoveStat, type Lc0MoveStat } from "@chaturanga/shared/engine/uci";
import {
  buildRatingPrediction,
  computeEvalLoss,
  linesFromInfoStream,
  maiaRatingFromText,
  parseTimeControl,
  selectMaiaEnginesForReview,
  tacticalMotifsForBestMove,
  terminalScore,
  timeSpentForMove
} from "./review-analysis";

const ITALIAN = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";

function fixture(name: string): string[] {
  return readFileSync(join(__dirname, "__fixtures__", name), "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
}

/** Replays captured lc0 output through the same parsing path as UciReviewSession.analyzePolicy. */
function policyFromFixture(name: string): {
  stats: Lc0MoveStat[];
  wdl?: { win: number; draw: number; loss: number };
} {
  const stats: Lc0MoveStat[] = [];
  let wdl: { win: number; draw: number; loss: number } | undefined;
  for (const line of fixture(name)) {
    if (line.startsWith("bestmove")) break;
    const stat = parseLc0MoveStat(line);
    if (stat) stats.push(stat);
    else {
      const info = parseInfoLine("maia", line);
      if (info?.wdl) wdl = info.wdl;
    }
  }
  return { stats, wdl };
}

function engine(partial: Partial<EngineConfig> & { id: string }): EngineConfig {
  return {
    name: partial.id,
    executablePath: "/bin/lc0",
    workingDirectory: null,
    weightsPath: null,
    imagePath: null,
    args: [],
    protocol: "uci",
    runtime: "custom-uci",
    isAvailable: true,
    isDefault: false,
    createdAt: 0,
    updatedAt: 0,
    ...partial
  };
}

function line(multipv: number, cp: number, pv: string[], mate = false): AnalysisLine {
  const score = { type: mate ? ("mate" as const) : ("cp" as const), value: cp };
  return { multipv, depth: 12, score, scoreWhite: score, pv };
}

describe("Maia policy from real lc0 VerboseMoveStats output", () => {
  it("parses every legal move with real, rating-dependent probabilities", () => {
    const low = policyFromFixture("maia-1100-italian.txt");
    const high = policyFromFixture("maia-1900-italian.txt");
    // 27 legal moves + the root "node" line.
    expect(low.stats).toHaveLength(28);
    const sum = low.stats.filter((s) => s.move !== "node").reduce((acc, s) => acc + s.p, 0);
    expect(sum).toBeGreaterThan(0.98);
    expect(sum).toBeLessThan(1.02);
    expect(low.wdl).toEqual({ win: 496, draw: 39, loss: 465 });

    const p1100 = buildRatingPrediction({
      rating: 1100,
      fen: ITALIAN,
      ...low,
      playedUci: "f1b5",
      bestUci: "f1b5"
    })!;
    const p1900 = buildRatingPrediction({
      rating: 1900,
      fen: ITALIAN,
      ...high,
      playedUci: "f1b5",
      bestUci: "f1b5"
    })!;
    expect(p1100.topMoves[0]).toEqual({ uci: "f1c4", prob: 0.2375 });
    expect(p1900.topMoves[0]).toEqual({ uci: "f1c4", prob: 0.3123 });
    expect(p1100.topMoves.length).toBe(10);
    // Not the old uniform 0.20 softmax artefact: the played move's probability differs by level.
    expect(p1100.playedProb).not.toBeCloseTo(p1900.playedProb!, 2);
    expect(p1900.playedProb).toBeCloseTo(0.2318, 4);
    expect(p1900.playedRank).toBe(2);
    expect(p1900.bestRank).toBe(2);
    expect(p1100.value).toBeCloseTo(0.0331, 4);
    expect(p1100.wdl).toEqual({ win: 496, draw: 39, loss: 465 });
  });

  it("reports a legal-but-unlisted played move as probability 0 with no rank", () => {
    const low = policyFromFixture("maia-1100-italian.txt");
    const prediction = buildRatingPrediction({
      rating: 1100,
      fen: ITALIAN,
      ...low,
      playedUci: "a1a8",
      bestUci: null
    })!;
    expect(prediction.playedProb).toBe(0);
    expect(prediction.playedRank).toBeUndefined();
    expect(prediction.bestRank).toBeUndefined();
  });

  it("normalizes lc0 king-takes-rook castling to standard UCI", () => {
    const fen = "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4";
    const stats = [
      parseLc0MoveStat(
        "info string e1h1  (103 ) N:       0 (+ 0) (P: 23.04%) (WL:  -.-----) (D: -.---) (M:  -.-) (Q: -0.00973) (U: 0.40209) (S:  0.39235) (V:  -.----)"
      )!
    ];
    const prediction = buildRatingPrediction({
      rating: 1500,
      fen,
      stats,
      playedUci: "e1g1",
      bestUci: "e1g1"
    })!;
    expect(prediction.topMoves[0].uci).toBe("e1g1");
    expect(prediction.playedRank).toBe(1);
  });
});

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
    expect(only.scoreWhite).toEqual({ type: "cp", value: -20 });
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
    expect(tacticalMotifsForBestMove(fen, "e4d5", { type: "cp", value: 30 })).toEqual([]);
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

describe("clocks", () => {
  it("uses the mover's own previous clock plus increment", () => {
    const moves = [
      { clockAfter: "0:10:00" }, // white
      { clockAfter: "0:09:50" }, // black
      { clockAfter: "0:09:30" }, // white spent 30s, +5 inc
      { clockAfter: "0:09:48" } // black spent 2s, +5 inc
    ];
    const tc = parseTimeControl("600+5");
    expect(tc).toEqual({ baseMs: 600_000, incrementMs: 5000 });
    expect(timeSpentForMove(moves, 2, tc)).toBe(35_000);
    expect(timeSpentForMove(moves, 3, tc)).toBe(7000);
    expect(timeSpentForMove(moves, 1, tc)).toBe(15_000);
    expect(timeSpentForMove(moves, 1, null)).toBeUndefined();
    expect(parseTimeControl("-")).toBeNull();
  });
});

describe("Maia engine selection", () => {
  it("keeps one available engine per rating, prefers managed over custom, honours levels", () => {
    const selected = selectMaiaEnginesForReview(
      [
        engine({ id: "custom1500", name: "Maia 1500", maiaRating: 1500 }),
        engine({ id: "m1500", name: "Maia 1500 (managed)", maiaRating: 1500 }),
        engine({ id: "custom1500b", name: "My Maia", maiaRating: 1500 }),
        engine({ id: "m1100", weightsPath: "/w/maia-1100.pb.gz" }),
        engine({ id: "broken", maiaRating: 1900, isAvailable: false }),
        engine({ id: "lc0", weightsPath: "/w/BT4-1100k.pb.gz" }),
        engine({ id: "m1700", maiaRating: 1700 })
      ],
      [1100, 1500, 1900]
    );
    expect(selected.map((e) => [e.id, e.maiaRating])).toEqual([
      ["m1100", 1100],
      ["m1500", 1500]
    ]);
  });

  it("only infers ratings from Maia-named text", () => {
    expect(maiaRatingFromText("maia-1900.pb.gz")).toBe(1900);
    expect(maiaRatingFromText("t1-256x10-1500k.pb.gz")).toBeUndefined();
  });
});
