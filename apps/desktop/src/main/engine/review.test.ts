import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  EngineConfig,
  MoveReview,
  ReviewMoveInputItem,
  ReviewSideRating
} from "@chaturanga/shared/types/engine";
import { applySan, fenAfterUci } from "@chaturanga/shared/chess/position";
import { MOVE_ASSESSMENT_POLICY } from "@chaturanga/shared/chess/move-assessment";
import {
  Maia3UnavailableError,
  type Maia3Evaluator,
  type Maia3Query
} from "@chaturanga/shared/engine/maia3";
import { fixtureMaia3Output } from "../maia/fixture-evaluator";
import { analysePositionsWithEngine, reviewGameWithEngine, type ReviewMaia } from "./review";

const FAKE = join(__dirname, "__fixtures__", "fake-uci.mjs");
/** The scripted engine with review lines for the Blackburne Shilling trap (see its "review" modes). */
const SCRIPTED = join(__dirname, "__fixtures__", "fake-live-uci.mjs");
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** A reviewed move's annotation (null when it was left unassessed). */
const annotationOf = (move: MoveReview) => move.assessment?.annotation ?? null;

/** A move-completed listener that runs `then` once move `index` is done. */
const afterMove =
  (index: number, then: () => void) =>
  ({ moveIndex }: { moveIndex: number }) => {
    if (moveIndex === index) then();
  };

function fakeEngine(id: string, mode: "sf", extra: Partial<EngineConfig> = {}): EngineConfig {
  return {
    id,
    name: id,
    executablePath: process.execPath,
    workingDirectory: null,
    weightsPath: null,
    imagePath: null,
    args: [FAKE, mode],
    protocol: "uci",
    runtime: "custom-uci",
    isAvailable: true,
    isDefault: false,
    createdAt: 0,
    updatedAt: 0,
    ...extra
  };
}

function foolsMate(): ReviewMoveInputItem[] {
  const ucis = ["f2f3", "e7e5", "g2g4", "d8h4"];
  const sans = ["f3", "e5", "g4", "Qh4#"];
  let fen = START;
  return ucis.map((uci, index) => {
    const fenAfter = fenAfterUci(fen, uci)!;
    const item = {
      nodeId: `n${index}`,
      ply: index + 1,
      san: sans[index],
      uci,
      fenBefore: fen,
      fenAfter
    };
    fen = fenAfter;
    return item;
  });
}

/** 1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3# (first `plies`). */
function trapGame(plies = 14): ReviewMoveInputItem[] {
  const sans = [
    "e4",
    "e5",
    "Nf3",
    "Nc6",
    "Bc4",
    "Nd4",
    "Nxe5",
    "Qg5",
    "Nxf7",
    "Qxg2",
    "Rf1",
    "Qxe4+",
    "Be2",
    "Nf3#"
  ];
  let fen = START;
  return sans.slice(0, plies).map((san, index) => {
    const played = applySan(fen, san)!;
    const item = {
      nodeId: `t${index}`,
      ply: index + 1,
      san: played.san,
      uci: played.uci,
      fenBefore: fen,
      fenAfter: played.fen
    };
    fen = played.fen;
    return item;
  });
}

function scriptedEngine(
  id: string,
  log: string,
  mode: "review" | "review-unstable" | "review-stuck-check"
): EngineConfig {
  return fakeEngine(id, "sf", { args: [SCRIPTED, log, mode] });
}

type MaiaCall = {
  queries: Maia3Query[];
  priority?: "game" | "review";
  signal?: AbortSignal;
};

/**
 * Maia 3 without the model: the e2e fixture's policy, and White's winning chances = eloSelf / 10 000
 * (so a prediction shows the rating it was read at). `answer(call)` may fail a call (throw) or hold
 * it (a promise), as may `failOn`; every call is recorded, and `onCall` runs as it comes in.
 */
function fakeMaia(
  options: {
    installed?: boolean;
    answer?: (call: number, signal?: AbortSignal) => Promise<void> | void;
    /** The call (1-based) that fails as a crashed host's would. */
    failOn?: number;
    onCall?: () => void;
  } = {}
): { evaluator: Maia3Evaluator; calls: MaiaCall[] } {
  const calls: MaiaCall[] = [];
  const evaluator: Maia3Evaluator = {
    isInstalled: () => options.installed ?? true,
    dispose: () => {},
    evaluate: async (queries, { priority, signal } = {}) => {
      calls.push({ queries: [...queries], priority, signal });
      options.onCall?.();
      if (calls.length === options.failOn) throw new Error("Maia host crashed");
      await options.answer?.(calls.length, signal);
      return queries.map((query) => ({
        ...fixtureMaia3Output(query),
        value: query.eloSelf / 10_000
      }));
    }
  };
  return { evaluator, calls };
}

const rated = (rating: number, source: ReviewSideRating["source"] = "game"): ReviewSideRating => ({
  rating,
  source
});

function maiaOf(
  evaluator: Maia3Evaluator,
  white = rated(1200),
  black = rated(1800),
  modelVersion = "maia3-test"
): ReviewMaia {
  return { evaluator, modelVersion, ratings: { white, black } };
}

/** A Maia query for `fen` at `rating` (eloSelf = eloOppo). */
const queryAt = (fen: string, rating: number): Maia3Query => ({
  fen,
  eloSelf: rating,
  eloOppo: rating
});

describe("reviewGameWithEngine (scripted UCI engines)", () => {
  it("records engine data, reads every move with Maia 3 at its mover's rating and synthesizes the terminal eval", async () => {
    const { evaluator, calls } = fakeMaia();
    const phases: string[] = [];
    const moves = foolsMate();
    const review = await reviewGameWithEngine(
      fakeEngine("sf", "sf"),
      {
        reviewId: "t",
        engineId: "sf",
        rootFen: START,
        moves,
        multipv: 3,
        moveTimeMs: 50
      },
      { onPhaseProgress: (p) => phases.push(`${p.moveIndex}:${p.phase}`) },
      { maia: maiaOf(evaluator), threads: 2, hashMb: 64 }
    );

    expect(review.schemaVersion).toBe(4);
    expect(review.assessmentPolicy).toBe(MOVE_ASSESSMENT_POLICY);
    expect(review.engineName).toBe("Fake sf");
    expect(review.engineSettings).toStrictEqual({
      multipv: 3,
      moveTimeMs: 50,
      depth: null,
      threads: 2,
      hashMb: 64
    });
    // Maia 3 is recorded with the rating each side was read at.
    expect(review.maia).toStrictEqual({
      model: "maia3",
      modelVersion: "maia3-test",
      white: rated(1200),
      black: rated(1800)
    });
    expect(review.maiaEngines).toBeUndefined();
    // One query per move, the position before it, at the mover's rating, behind any game's.
    const moverRatings = [1200, 1800, 1200, 1800];
    expect(calls.map((call) => call.queries)).toStrictEqual(
      moves.map((move, index) => [queryAt(move.fenBefore, moverRatings[index])])
    );
    expect(calls.map((call) => [call.priority, call.signal instanceof AbortSignal])).toStrictEqual(
      moves.map(() => ["review", true])
    );
    // One progress event per phase per move; no "after" phase for the mating move.
    expect(phases).toStrictEqual([
      "0:before",
      "0:after",
      "1:before",
      "1:after",
      "2:before",
      "2:after",
      "3:before"
    ]);

    const first = review.moves[0];
    expect(first.topLines).toHaveLength(3);
    expect(first.topLines[0].wdl).toStrictEqual({ win: 300, draw: 500, loss: 200 });
    expect(first.replyLines).toHaveLength(3);
    expect(first.wdlBefore).toStrictEqual({ win: 300, draw: 500, loss: 200 });
    expect(review.moves.map((move) => move.moverPrediction?.rating)).toStrictEqual(moverRatings);
    expect(first.moverPrediction).toMatchObject({ whiteWinProb: 0.12, playedRank: 13 });
    expect(first.moverPrediction?.topMoves).toHaveLength(5);
    expect(first.humanPredictions).toBeUndefined();
    // g2g4 is the fake engine's 2nd line → same-search rank and score.
    const third = review.moves[2];
    expect(third.playedRank).toBe(2);
    expect(third.playedLineScore).toStrictEqual({ type: "cp", value: 20 });
    expect(third.evalLoss).toBe(20);

    const last = review.moves[3];
    expect(last.terminal).toBe("checkmate");
    expect(last.evalAfter).toStrictEqual({ type: "mate", value: 0 });
    expect(last.replyLines).toStrictEqual([]);
    expect(last.wdlAfter).toStrictEqual({ win: 0, draw: 0, loss: 1000 });
    expect(last.evalLoss).toBe(0);
    // Fool's mate is a named line of the opening book, mate and all: every move is Book, none an
    // error, and the game's opening is its name.
    expect(review.moves.map((move) => move.assessment?.annotation)).toStrictEqual([
      "book",
      "book",
      "book",
      "book"
    ]);
    expect(last.assessment).toMatchObject({ severity: null, annotation: "book" });
    expect(review.opening).toStrictEqual({
      eco: "A00",
      name: "Barnes Opening: Fool's Mate",
      ply: 4,
      bookEndPly: 4,
      firstNonBookMove: null
    });
    expect(last.classification).toBeUndefined();
    expect(review.moves.every((move) => move.assessment?.policy === MOVE_ASSESSMENT_POLICY)).toBe(
      true
    );
  }, 30_000);

  it("marks only the moves that matter, verifying the critical find with a deeper search", async () => {
    const log = join(mkdtempSync(join(tmpdir(), "review-marks-")), "uci.log");
    const streamed: { moveIndex: number; opening: unknown }[] = [];
    const review = await reviewGameWithEngine(
      scriptedEngine("scripted", log, "review"),
      {
        reviewId: "m",
        engineId: "scripted",
        rootFen: START,
        moves: trapGame(),
        multipv: 3,
        moveTimeMs: 40
      },
      { onMoveCompleted: ({ moveIndex, opening }) => streamed.push({ moveIndex, opening }) }
    );
    // The first six moves are opening theory: 3… Nd4 is the Blackburne–Kostić Gambit, so Book.
    expect(review.moves.map((move) => [move.san, annotationOf(move)])).toStrictEqual([
      ["e4", "book"],
      ["e5", "book"],
      ["Nf3", "book"],
      ["Nc6", "book"],
      ["Bc4", "book"],
      ["Nd4", "book"],
      ["Nxe5", "blunder"],
      ["Qg5", "great"],
      ["Nxf7", "blunder"],
      ["Qxg2", "good"],
      ["Rf1", null],
      ["Qxe4+", null],
      ["Be2", "mistake"],
      ["Nf3#", null]
    ]);
    const qg5 = review.moves[7];
    expect(qg5.verification?.deeperLines?.map((line) => line.pv[0])).toStrictEqual([
      "d8g5",
      "d8e7",
      "d4c2"
    ]);
    expect(qg5.assessment?.tags).toStrictEqual(
      expect.arrayContaining(["engine_top", "punishes_error", "only_move"])
    );
    expect(review.moves[12].assessment?.tags).toContain("mate_created");
    // Only the critical find needed a check; the routine moves and the clear errors didn't.
    expect(review.moves.filter((move) => move.verification).map((move) => move.san)).toStrictEqual([
      "Qg5"
    ]);
    expect(review.summary).toMatchObject({
      book: 6,
      inaccuracies: 0,
      mistakes: 1,
      blunders: 2,
      great: 1,
      good: 1,
      brilliant: 0
    });
    expect(review.opening).toMatchObject({
      eco: "C50",
      name: "Italian Game: Blackburne-Kostić Gambit",
      firstNonBookMove: { ply: 7, san: "Nxe5" }
    });
    // Each finished move carries the opening, so a running review can name it from the first.
    expect(streamed).toStrictEqual(
      review.moves.map((_, moveIndex) => ({ moveIndex, opening: review.opening }))
    );
  }, 30_000);

  it("withholds a mark a deeper search disagrees with, and searches a borderline error's move alone", async () => {
    const log = join(mkdtempSync(join(tmpdir(), "review-unstable-")), "uci.log");
    const review = await reviewGameWithEngine(
      scriptedEngine("scripted-unstable", log, "review-unstable"),
      {
        reviewId: "u",
        engineId: "scripted-unstable",
        rootFen: START,
        moves: trapGame(8),
        multipv: 3,
        moveTimeMs: 40
      }
    );
    const [nxe5, qg5] = review.moves.slice(6);
    // From the reply search Nxe5 lost 15.4 points (a blunder by a hair); the played move searched
    // on its own, from the same position, shows it lost 13.6.
    expect(nxe5.verification?.playedLine).toMatchObject({
      pv: ["f3e5", "d8g5"],
      score: { type: "cp", value: -30 }
    });
    expect(nxe5.assessment).toMatchObject({
      severity: "mistake",
      annotation: "mistake",
      winLoss: 13.6
    });
    // Qg5 looked like the only move; the deeper search preferred Qe7, so it is not marked Great.
    expect(qg5.assessment?.annotation).toBe("good");
    expect(qg5.assessment?.tags).toContain("unstable");
  }, 30_000);
});

describe("review with Maia 3", () => {
  const input = (reviewId: string, engineId: string, moves = foolsMate()) => ({
    reviewId,
    engineId,
    rootFen: START,
    moves,
    multipv: 2,
    moveTimeMs: 40
  });

  it("asks Maia about each move while the engine searches it, and nothing else", async () => {
    const order: string[] = [];
    const { evaluator, calls } = fakeMaia({ onCall: () => order.push("maia") });
    const moves = foolsMate().slice(0, 3);
    const review = await reviewGameWithEngine(
      fakeEngine("sf-maia-order", "sf"),
      input("o", "sf-maia-order", moves),
      { onPhaseProgress: (p) => order.push(`${p.moveIndex}:${p.phase}`) },
      { maia: maiaOf(evaluator) }
    );
    // Asked as the move's first search starts, before the search of the position after it.
    expect(order).toStrictEqual([
      "0:before",
      "maia",
      "0:after",
      "1:before",
      "maia",
      "1:after",
      "2:before",
      "maia",
      "2:after"
    ]);
    expect(calls).toHaveLength(moves.length);
    expect(review.maia).toMatchObject({ white: rated(1200), black: rated(1800) });
  });

  it("completes without Maia when Maia 3 isn't available, asking it once", async () => {
    const { evaluator, calls } = fakeMaia({
      answer: () => {
        throw new Maia3UnavailableError("Maia 3 isn't installed");
      }
    });
    const review = await reviewGameWithEngine(
      fakeEngine("sf-maia-missing", "sf"),
      input("u", "sf-maia-missing"),
      {},
      { maia: maiaOf(evaluator) }
    );
    expect(calls).toHaveLength(1);
    expect(review.maia).toBeUndefined();
    expect(review.moves.map((move) => move.moverPrediction)).toStrictEqual([
      undefined,
      undefined,
      undefined,
      undefined
    ]);
    expect(review.moves.every((move) => move.assessment)).toBe(true);
  });

  it("a Maia failure mid-review drops only Maia; its moves are reviewed again next time", async () => {
    const failSecond = fakeMaia({ failOn: 2 });
    const run = async (evaluator: Maia3Evaluator) => {
      const phases: string[] = [];
      const review = await reviewGameWithEngine(
        fakeEngine("sf-maia-fail", "sf"),
        input("f", "sf-maia-fail"),
        { onPhaseProgress: (p) => phases.push(`${p.moveIndex}:${p.phase}`) },
        { maia: maiaOf(evaluator) }
      );
      return { review, phases };
    };
    const { review } = await run(failSecond.evaluator);
    expect(failSecond.calls).toHaveLength(2);
    expect(review.moves.map((move) => move.moverPrediction?.rating)).toStrictEqual([
      1200,
      undefined,
      undefined,
      undefined
    ]);
    // Recorded for the move it read.
    expect(review.maia).toMatchObject({ white: rated(1200), black: rated(1800) });
    expect(review.moves.every((move) => move.assessment)).toBe(true);

    // The move Maia answered was kept; the rest are reviewed again (with Maia working).
    const working = fakeMaia();
    const again = await run(working.evaluator);
    expect(again.phases).toStrictEqual(["1:before", "1:after", "2:before", "2:after", "3:before"]);
    expect(again.review.moves.map((move) => move.moverPrediction?.rating)).toStrictEqual([
      1200, 1800, 1200, 1800
    ]);
  });

  it("cancelling aborts the Maia request in flight", async () => {
    let cancelled = false;
    const { evaluator, calls } = fakeMaia({
      // Held until the review aborts it, as a request queued behind a game's would be.
      answer: (_call, signal) =>
        new Promise((_resolve, reject) => {
          cancelled = true;
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        })
    });
    await expect(
      reviewGameWithEngine(
        fakeEngine("sf-maia-cancel", "sf"),
        input("c", "sf-maia-cancel"),
        { shouldCancel: () => cancelled },
        { maia: maiaOf(evaluator) }
      )
    ).rejects.toThrow("Review cancelled");
    expect(calls).toHaveLength(1);
    expect(calls[0].signal?.aborted).toBe(true);
  });

  it("reuses a review's moves only at the same Maia ratings and model", async () => {
    const run = async (maia: (evaluator: Maia3Evaluator) => ReviewMaia) => {
      const { evaluator, calls } = fakeMaia();
      const phases: string[] = [];
      await reviewGameWithEngine(
        fakeEngine("sf-maia-cache", "sf"),
        input("k", "sf-maia-cache"),
        { onPhaseProgress: (p) => phases.push(`${p.moveIndex}:${p.phase}`) },
        { maia: maia(evaluator) }
      );
      return { phases: phases.length, calls: calls.length };
    };
    const first = await run((evaluator) => maiaOf(evaluator));
    expect(first).toStrictEqual({ phases: 7, calls: 4 });
    // The final position is a mate: nothing left to ask.
    expect(await run((evaluator) => maiaOf(evaluator))).toStrictEqual({ phases: 0, calls: 0 });
    // The same ratings from another source read the same moves.
    expect(
      await run((evaluator) => maiaOf(evaluator, rated(1200, "override"), rated(1800, "override")))
    ).toStrictEqual({ phases: 0, calls: 0 });
    expect(await run((evaluator) => maiaOf(evaluator, rated(1200), rated(1900)))).toStrictEqual(
      first
    );
    expect(
      await run((evaluator) => maiaOf(evaluator, rated(1200), rated(1800), "maia3-next"))
    ).toStrictEqual(first);
  });
});

describe("review checks", () => {
  it("a check search that hangs leaves the move unverified and the review goes on", async () => {
    const log = join(mkdtempSync(join(tmpdir(), "review-stuck-")), "uci.log");
    const review = await reviewGameWithEngine(
      scriptedEngine("scripted-stuck", log, "review-stuck-check"),
      {
        reviewId: "s",
        engineId: "scripted-stuck",
        rootFen: START,
        moves: trapGame(),
        multipv: 3,
        moveTimeMs: 40
      },
      {},
      { checkTimeoutMs: 300 }
    );
    const qg5 = review.moves[7];
    expect(qg5.verification).toBeUndefined();
    // Not Great without the check; it still punished Nxe5.
    expect(qg5.assessment?.annotation).toBe("good");
    expect(qg5.assessment?.tags).toContain("unverified");
    // The searches after it read their own answers.
    expect(review.moves.slice(8).map(annotationOf)).toStrictEqual([
      "blunder",
      "good",
      null,
      null,
      "mistake",
      null
    ]);
  }, 30_000);

  it("cancelling during a check still cancels the review", async () => {
    const log = join(mkdtempSync(join(tmpdir(), "review-stuck-cancel-")), "uci.log");
    let cancelled = false;
    const started = Date.now();
    await expect(
      reviewGameWithEngine(
        scriptedEngine("scripted-stuck-cancel", log, "review-stuck-check"),
        {
          reviewId: "sc",
          engineId: "scripted-stuck-cancel",
          rootFen: START,
          moves: trapGame(),
          multipv: 3,
          moveTimeMs: 40
        },
        {
          // Qg5 (move 8) is checked right after Nxe5 completes: cancel while it hangs.
          onMoveCompleted: afterMove(6, () => setTimeout(() => (cancelled = true), 200)),
          shouldCancel: () => cancelled
        },
        { checkTimeoutMs: 20_000 }
      )
    ).rejects.toThrow("Review cancelled");
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 30_000);
});

describe("review reuse", () => {
  it("a second review with the same settings reuses every finished move; new settings review again", async () => {
    const run = async (moveTimeMs: number) => {
      const phases: string[] = [];
      const review = await reviewGameWithEngine(
        fakeEngine("sf-cache", "sf"),
        {
          reviewId: "c",
          engineId: "sf-cache",
          rootFen: START,
          moves: foolsMate(),
          multipv: 2,
          moveTimeMs
        },
        { onPhaseProgress: (p) => phases.push(`${p.moveIndex}:${p.phase}`) }
      );
      return { review, phases };
    };
    const first = await run(77);
    expect(first.phases.length).toBeGreaterThan(0);

    const again = await run(77);
    expect(again.phases).toStrictEqual([]);
    expect(again.review.moves.map((move) => [move.nodeId, move.assessment])).toStrictEqual(
      first.review.moves.map((move) => [move.nodeId, move.assessment])
    );

    const otherBudget = await run(78);
    expect(otherBudget.phases).toHaveLength(first.phases.length);
  });

  // A shell wrapper stands in for the engine binary, so it can be replaced at the same path.
  it.skipIf(process.platform === "win32")(
    "an engine binary replaced at the same path reviews again",
    async () => {
      const executablePath = join(mkdtempSync(join(tmpdir(), "review-cache-")), "engine");
      const install = (version: string) =>
        writeFileSync(
          executablePath,
          `#!/bin/sh\n# ${version}\nexec "${process.execPath}" "${FAKE}" sf\n`,
          { mode: 0o755 }
        );
      install("v1");
      const run = async () => {
        const phases: string[] = [];
        await reviewGameWithEngine(
          fakeEngine("sf-binary", "sf", { executablePath, args: [] }),
          {
            reviewId: "b",
            engineId: "sf-binary",
            rootFen: START,
            moves: foolsMate(),
            multipv: 2,
            moveTimeMs: 50
          },
          { onPhaseProgress: (p) => phases.push(`${p.moveIndex}:${p.phase}`) }
        );
        return phases;
      };
      const first = await run();
      expect(first.length).toBeGreaterThan(0);
      expect(await run()).toStrictEqual([]);

      install("v2 (updated)");
      expect(await run()).toHaveLength(first.length);
    }
  );

  it.skipIf(process.platform === "win32")(
    "a binary replaced while the engine starts is not cached",
    async () => {
      const executablePath = join(mkdtempSync(join(tmpdir(), "review-cache-")), "engine");
      // Every start replaces the file it was launched from, as an update landing mid-startup would.
      writeFileSync(
        executablePath,
        `#!/bin/sh\necho "# replaced" >> "$0"\nexec "${process.execPath}" "${FAKE}" sf\n`,
        {
          mode: 0o755
        }
      );
      const run = async () => {
        const phases: string[] = [];
        await reviewGameWithEngine(
          fakeEngine("sf-racing", "sf", { executablePath, args: [] }),
          {
            reviewId: "r",
            engineId: "sf-racing",
            rootFen: START,
            moves: foolsMate(),
            multipv: 2,
            moveTimeMs: 50
          },
          { onPhaseProgress: (p) => phases.push(`${p.moveIndex}:${p.phase}`) }
        );
        return phases;
      };
      const first = await run();
      expect(await run()).toHaveLength(first.length);
    }
  );
});

describe("analysePositionsWithEngine", () => {
  it("searches each position with its own line count and skips a finished one", async () => {
    const mated = foolsMate()[3].fenAfter;
    const result = await analysePositionsWithEngine(
      fakeEngine("sf", "sf"),
      {
        positions: [
          { fen: START, multipv: 3 },
          { fen: mated, multipv: 2 },
          { fen: START, multipv: 1 }
        ],
        moveTimeMs: 50
      },
      { threads: 1, hashMb: 16 }
    );
    expect(result.engineName).toBe("Fake sf");
    expect(result.lines.map((lines) => lines.length)).toStrictEqual([3, 0, 1]);
    expect(result.lines[0][0]).toMatchObject({
      multipv: 1,
      pv: ["d1h5"],
      scoreWhite: { type: "cp", value: 40 }
    });
  });

  it("is cancelled while the engine is still starting up", async () => {
    let cancelled = false;
    setTimeout(() => {
      cancelled = true;
    }, 100);
    await expect(
      analysePositionsWithEngine(
        fakeEngine("slow", "sf", { args: [FAKE, "sf", "slow-start"] }),
        { positions: [{ fen: START, multipv: 1 }], moveTimeMs: 50 },
        { shouldCancel: () => cancelled }
      )
    ).rejects.toThrow("Review cancelled");
  });

  it("refuses the partial lines a search stopped by the cancel still ends with", async () => {
    const log = join(mkdtempSync(join(tmpdir(), "chaturanga-review-test-")), "commands.log");
    writeFileSync(log, "");
    // Cancelled once the engine is searching: it has printed its lines and answers the stop with a bestmove.
    const searching = () =>
      readFileSync(log, "utf8")
        .split("\n")
        .some((line) => line.startsWith("go "));
    await expect(
      analysePositionsWithEngine(
        fakeEngine("stoppable", "sf", { args: [FAKE, "sf", "wait-for-stop", log] }),
        { positions: [{ fen: START, multipv: 2 }], moveTimeMs: 50 },
        { shouldCancel: searching }
      )
    ).rejects.toThrow("Review cancelled");
    const commands = readFileSync(log, "utf8").split("\n");
    expect(commands.findIndex((line) => line.startsWith("go "))).toBeLessThan(
      commands.indexOf("stop")
    );
  });
});

describe("review cancellation", () => {
  it("is honoured while the engine is still starting up", async () => {
    const started = Date.now();
    // Cancelled from the second check on. Checks are polled while waiting for the engine, startup
    // included, and the slow-start fake takes 10 s to answer: ending in time means startup heard it.
    let checks = 0;
    await expect(
      reviewGameWithEngine(
        fakeEngine("slow", "sf", { args: [FAKE, "sf", "slow-start"] }),
        { reviewId: "r", engineId: "slow", rootFen: START, moves: foolsMate() },
        { shouldCancel: () => ++checks > 1 }
      )
    ).rejects.toThrow("Review cancelled");
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
