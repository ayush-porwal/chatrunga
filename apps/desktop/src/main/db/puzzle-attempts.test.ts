import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PUZZLE_RATING, rateAttempt, ratingAfterIdle } from "@chaturanga/shared/chess/puzzle-rating";
import type { RecordPuzzleAttemptInput } from "@chaturanga/shared/types/puzzle-rating";

const userData = mkdtempSync(join(tmpdir(), "chaturanga-puzzle-attempts-test-"));
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

const { closeDb, getDb } = await import("./index");
const { puzzleAttemptRepository: repository } = await import("./puzzle-attempts");

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 3, 12);
let sequence = 0;

function attempt(patch: Partial<RecordPuzzleAttemptInput> = {}): RecordPuzzleAttemptInput {
  sequence += 1;
  return {
    attemptId: `attempt-${sequence}`,
    puzzleId: `p${sequence}`,
    databaseId: "db-lichess",
    sourceId: "lichess-puzzles",
    outcome: "solved",
    puzzleRating: 1500,
    puzzleRatingDeviation: 75,
    themes: ["fork", "short"],
    wrongMoveCount: 0,
    solutionViewed: false,
    startedAt: T0 + sequence * 1000 - 500,
    decidedAt: T0 + sequence * 1000,
    completedAt: T0 + sequence * 1000,
    ...patch
  };
}

describe("puzzleAttemptRepository (SQLite)", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM puzzle_attempts");
    getDb().exec("DELETE FROM puzzle_rating");
  });

  afterAll(() => {
    closeDb();
    rmSync(userData, { recursive: true, force: true });
  });

  it("rates the first try at a Lichess puzzle from the defaults and stores the new rating", () => {
    const input = attempt();
    const result = repository.record(input, T0 + DAY);
    const expected = rateAttempt(DEFAULT_PUZZLE_RATING, { rating: 1500, deviation: 75 }, true, input.decidedAt);
    expect(result).toEqual({
      attemptId: input.attemptId,
      rated: true,
      unratedReason: null,
      before: DEFAULT_PUZZLE_RATING,
      after: expected,
      delta: Math.round(expected.rating) - 1500
    });
    expect(result.delta).toBeGreaterThan(0);
    const summary = repository.summary(input.decidedAt);
    expect(summary).toMatchObject({ rating: expected.rating, deviation: expected.deviation, ratedCount: 1, attemptCount: 1, solvedCount: 1, provisional: true });
  });

  it("chains ratings: each rated attempt starts from the last one's result", () => {
    const first = repository.record(attempt({ outcome: "solved" }));
    const second = repository.record(attempt({ outcome: "failed", wrongMoveCount: 1 }));
    expect(second.before).toMatchObject({ rating: first.after!.rating, volatility: first.after!.volatility });
    expect(second.before!.deviation).toBeCloseTo(first.after!.deviation, 3); // widened for a second only
    expect(second.delta).toBeLessThan(0);
    expect(repository.history().map((point) => point.rating)).toEqual([first.after!.rating, second.after!.rating]);
  });

  it("records the same attempt once: a repeat returns the stored result and only adds what was learned since", () => {
    const input = attempt({ outcome: "failed", wrongMoveCount: 1, completedAt: null });
    const first = repository.record(input);
    // Finished later, after two more wrong moves and a look at the solution.
    const again = repository.record({ ...input, outcome: "solved", wrongMoveCount: 3, solutionViewed: true, completedAt: input.decidedAt + 5000 });
    expect(again).toEqual(first);
    expect(repository.summary().ratedCount).toBe(1);
    const row = () =>
      getDb().prepare("SELECT outcome, wrong_move_count, solution_viewed, completed_at FROM puzzle_attempts WHERE id = ?").get(input.attemptId);
    expect(row()).toEqual({ outcome: "failed", wrong_move_count: 3, solution_viewed: 1, completed_at: input.decidedAt + 5000 });
    // An older copy arriving late takes nothing away.
    expect(repository.record({ ...input, completedAt: input.decidedAt + 9000 })).toEqual(first);
    expect(row()).toEqual({ outcome: "failed", wrong_move_count: 3, solution_viewed: 1, completed_at: input.decidedAt + 5000 });
  });

  it("only rates the first try at a puzzle: later ones are stored unrated", () => {
    const first = repository.record(attempt({ puzzleId: "same", outcome: "failed" }));
    const retry = repository.record(attempt({ puzzleId: "same", outcome: "solved" }));
    expect(first.rated).toBe(true);
    expect(retry).toMatchObject({ rated: false, unratedReason: "already-played", before: null, after: null, delta: null });
    expect(repository.summary()).toMatchObject({ ratedCount: 1, attemptCount: 2, solvedCount: 1 });
  });

  it("never rates a position-set puzzle or one without a Lichess rating", () => {
    const position = repository.record(attempt({ sourceId: "chess-position-analysis-results", puzzleRating: null, puzzleRatingDeviation: null }));
    const noDeviation = repository.record(attempt({ puzzleRatingDeviation: null }));
    expect(position).toMatchObject({ rated: false, unratedReason: "unrated-puzzle" });
    expect(noDeviation).toMatchObject({ rated: false, unratedReason: "unrated-puzzle" });
    expect(repository.summary()).toMatchObject({ ...DEFAULT_PUZZLE_RATING, ratedCount: 0, attemptCount: 2 });
  });

  it("plays an attempt at the rating widened for the idle time, and stores that as its rating before", () => {
    const first = repository.record(attempt({ decidedAt: T0 }), T0);
    const input = attempt({ decidedAt: T0 + 60 * DAY });
    const second = repository.record(input, T0 + 60 * DAY);
    const before = ratingAfterIdle(first.after!, T0, T0 + 60 * DAY);
    expect(before.deviation).toBeGreaterThan(first.after!.deviation);
    expect(second.before).toEqual(before);
    expect(second.after).toEqual(rateAttempt(before, { rating: 1500, deviation: 75 }, true, input.decidedAt));
    const row = getDb().prepare("SELECT rating_before, rd_before, volatility_before FROM puzzle_attempts WHERE id = ?").get(input.attemptId);
    expect(row).toEqual({ rating_before: before.rating, rd_before: before.deviation, volatility_before: before.volatility });
  });

  it("widens the shown deviation with time since the last rated attempt", () => {
    const input = attempt();
    repository.record(input);
    const soon = repository.summary(input.decidedAt).deviation;
    const later = repository.summary(input.decidedAt + 200 * DAY).deviation;
    expect(later).toBeGreaterThan(soon);
  });

  it("rates an attempt recorded after a later one on the current rating, with no idle time, keeping the later time", () => {
    const later = attempt({ decidedAt: T0 + 10 * DAY });
    const early = attempt({ decidedAt: T0 });
    const first = repository.record(later, T0 + 10 * DAY);
    const late = repository.record(early, T0 + 10 * DAY);
    expect(late.before).toEqual(first.after);
    expect(late.after).toEqual(rateAttempt(first.after!, { rating: 1500, deviation: 75 }, true, later.decidedAt));
    expect(repository.summary(T0 + 10 * DAY)).toMatchObject({ ...late.after, ratedCount: 2, lastRatedAt: later.decidedAt });
    // The chain is in the order recorded.
    expect(repository.history().map((point) => point.rating)).toEqual([first.after!.rating, late.after!.rating]);
  });

  it("rolls the rating back with the attempt when storing it fails", () => {
    const input = attempt();
    // A CHECK violation on the attempt row, after the rating row was written in the transaction.
    expect(() => repository.record({ ...input, outcome: "abandoned" as "solved" })).toThrow();
    expect(repository.summary()).toMatchObject({ ...DEFAULT_PUZZLE_RATING, ratedCount: 0, attemptCount: 0 });
  });

  it("counts rated attempts per theme with Lichess's performance", () => {
    repository.record(attempt({ themes: ["fork", "short"], puzzleRating: 1400, outcome: "solved" }));
    repository.record(attempt({ themes: ["fork"], puzzleRating: 1600, outcome: "failed" }));
    repository.record(attempt({ themes: ["pin"], puzzleRating: 1500, outcome: "solved" }));
    // Unrated tries don't count.
    repository.record(attempt({ themes: ["fork"], sourceId: "chess-position-analysis-results", puzzleRating: null, puzzleRatingDeviation: null }));
    expect(repository.themeStats()).toEqual([
      { theme: "fork", attempts: 2, solved: 1, performance: 1500 - 500 + 500 },
      { theme: "pin", attempts: 1, solved: 1, performance: 2000 },
      { theme: "short", attempts: 1, solved: 1, performance: 1900 }
    ]);
  });

  it("lists puzzles whose latest try failed, newest first, per source", () => {
    repository.record(attempt({ puzzleId: "a", outcome: "failed" }));
    repository.record(attempt({ puzzleId: "b", outcome: "failed" }));
    repository.record(attempt({ puzzleId: "a", outcome: "solved" })); // retried and solved
    repository.record(attempt({ puzzleId: "c", outcome: "solved" }));
    repository.record(attempt({ puzzleId: "x", outcome: "failed", sourceId: "chess-position-analysis-results", puzzleRating: null }));
    expect(repository.failed("lichess-puzzles").map((puzzle) => puzzle.puzzleId)).toEqual(["b"]);
    expect(repository.failed(null).map((puzzle) => puzzle.puzzleId)).toEqual(["x", "b"]);
    expect(repository.failed(null, 1)).toHaveLength(1);
    expect(repository.failed("lichess-puzzles")[0]).toMatchObject({ sourceId: "lichess-puzzles", databaseId: "db-lichess", puzzleRating: 1500 });
  });

  it("takes a puzzle's latest try by when it was decided, not when it was recorded", () => {
    // A solved retry recorded before the earlier failure it followed.
    repository.record(attempt({ puzzleId: "a", outcome: "solved", decidedAt: T0 + 2 * DAY }));
    repository.record(attempt({ puzzleId: "a", outcome: "failed", decidedAt: T0 + DAY }));
    // And a failed retry recorded before the earlier solve.
    repository.record(attempt({ puzzleId: "b", outcome: "failed", decidedAt: T0 + 2 * DAY }));
    repository.record(attempt({ puzzleId: "b", outcome: "solved", decidedAt: T0 + DAY }));
    // Decided at the same moment: the one recorded last.
    repository.record(attempt({ puzzleId: "c", outcome: "solved", decidedAt: T0 }));
    repository.record(attempt({ puzzleId: "c", outcome: "failed", decidedAt: T0 }));
    expect(repository.failed(null).map((puzzle) => [puzzle.puzzleId, puzzle.failedAt])).toEqual([
      ["b", T0 + 2 * DAY],
      ["c", T0]
    ]);
  });
});
