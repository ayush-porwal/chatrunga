/**
 * Puzzle attempts and the local puzzle rating (migration 9). Puzzles are never saved as library
 * games: each decided try is a row here, and the first try at a Lichess puzzle rates the solver
 * (chess/puzzle-rating.ts), in the same transaction as the row.
 */
import type { SQLInputValue } from "node:sqlite";
import type { Glicko2Rating } from "@chaturanga/shared/chess/glicko2";
import { DEFAULT_PUZZLE_RATING, isProvisional, puzzlePerformance, rateAttempt, ratingAfterIdle } from "@chaturanga/shared/chess/puzzle-rating";
import type {
  FailedPuzzle,
  PuzzleAttemptResult,
  PuzzleRatingPoint,
  PuzzleRatingSummary,
  PuzzleThemeStat,
  PuzzleUnratedReason,
  RecordPuzzleAttemptInput
} from "@chaturanga/shared/types/puzzle-rating";
import { getDb } from "./index";
import { transaction } from "./repositories";

/** Only the Lichess puzzle database carries Glicko-2 ratings; the position set is unrated. */
const RATED_SOURCE_ID = "lichess-puzzles";

type AttemptRow = {
  id: string;
  rated: number;
  unrated_reason: string | null;
  rating_before: number | null;
  rd_before: number | null;
  volatility_before: number | null;
  rating_after: number | null;
  rd_after: number | null;
  volatility_after: number | null;
  completed_at: number | null;
};

type RatingRow = {
  rating: number;
  rd: number;
  volatility: number;
  rated_count: number;
  last_rated_at: number | null;
};

function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

function get<T>(sql: string, ...params: SQLInputValue[]): T | null {
  return (getDb().prepare(sql).get(...params) as T | undefined) ?? null;
}

function run(sql: string, ...params: SQLInputValue[]): void {
  getDb().prepare(sql).run(...params);
}

function ratingOf(rating: number | null, deviation: number | null, volatility: number | null): Glicko2Rating | null {
  return rating === null || deviation === null || volatility === null ? null : { rating, deviation, volatility };
}

function toResult(row: AttemptRow): PuzzleAttemptResult {
  const before = ratingOf(row.rating_before, row.rd_before, row.volatility_before);
  const after = ratingOf(row.rating_after, row.rd_after, row.volatility_after);
  return {
    attemptId: row.id,
    rated: row.rated === 1,
    unratedReason: row.rated === 1 ? null : ((row.unrated_reason as PuzzleUnratedReason | null) ?? "unrated-puzzle"),
    before,
    after,
    delta: before && after ? Math.round(after.rating) - Math.round(before.rating) : null
  };
}

function storedRating(): RatingRow | null {
  return get<RatingRow>("SELECT rating, rd, volatility, rated_count, last_rated_at FROM puzzle_rating WHERE id = 1");
}

export const puzzleAttemptRepository = {
  /**
   * Stores a decided attempt and, for the first try at a rated puzzle, rates the solver. Recording
   * the same attempt again returns what was stored (never rating twice) and only fills in a
   * `completedAt` learned since (a failed puzzle finished afterwards).
   */
  record(input: RecordPuzzleAttemptInput, now: number = Date.now()): PuzzleAttemptResult {
    return transaction(() => {
      const existing = get<AttemptRow>("SELECT * FROM puzzle_attempts WHERE id = ?", input.attemptId);
      if (existing) {
        if (existing.completed_at === null && input.completedAt !== null) {
          run("UPDATE puzzle_attempts SET completed_at = ? WHERE id = ?", input.completedAt, input.attemptId);
        }
        return toResult(existing);
      }

      const ratedPuzzle =
        input.sourceId === RATED_SOURCE_ID && input.puzzleRating !== null && input.puzzleRatingDeviation !== null;
      const playedBefore = get<{ found: number }>(
        "SELECT 1 AS found FROM puzzle_attempts WHERE source_id = ? AND puzzle_id = ? LIMIT 1",
        input.sourceId,
        input.puzzleId
      );
      const unratedReason: PuzzleUnratedReason | null = !ratedPuzzle ? "unrated-puzzle" : playedBefore ? "already-played" : null;

      let before: Glicko2Rating | null = null;
      let after: Glicko2Rating | null = null;
      // The renderer's clock decides when it happened, but not in the future.
      const at = Math.min(input.decidedAt, now);
      if (unratedReason === null) {
        const stored = storedRating();
        before = stored ? { rating: stored.rating, deviation: stored.rd, volatility: stored.volatility } : DEFAULT_PUZZLE_RATING;
        after = rateAttempt(
          before,
          { rating: input.puzzleRating!, deviation: input.puzzleRatingDeviation! },
          input.outcome === "solved",
          at,
          stored?.last_rated_at ?? null
        );
        run(
          `INSERT INTO puzzle_rating (id, rating, rd, volatility, rated_count, last_rated_at, updated_at)
          VALUES (1, ?, ?, ?, 1, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            rating = excluded.rating,
            rd = excluded.rd,
            volatility = excluded.volatility,
            rated_count = puzzle_rating.rated_count + 1,
            last_rated_at = MAX(COALESCE(puzzle_rating.last_rated_at, 0), excluded.last_rated_at),
            updated_at = excluded.updated_at`,
          after.rating,
          after.deviation,
          after.volatility,
          at,
          now
        );
      }

      run(
        `INSERT INTO puzzle_attempts (
          id, puzzle_id, database_id, source_id, outcome, rated, unrated_reason, puzzle_rating, puzzle_rd,
          rating_before, rd_before, volatility_before, rating_after, rd_after, volatility_after,
          wrong_move_count, solution_viewed, themes_json, started_at, decided_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.attemptId,
        input.puzzleId,
        input.databaseId,
        input.sourceId,
        input.outcome,
        unratedReason === null ? 1 : 0,
        unratedReason,
        input.puzzleRating,
        input.puzzleRatingDeviation,
        before?.rating ?? null,
        before?.deviation ?? null,
        before?.volatility ?? null,
        after?.rating ?? null,
        after?.deviation ?? null,
        after?.volatility ?? null,
        input.wrongMoveCount,
        input.solutionViewed ? 1 : 0,
        JSON.stringify(input.themes),
        input.startedAt,
        input.decidedAt,
        input.completedAt
      );
      const stored = get<AttemptRow>("SELECT * FROM puzzle_attempts WHERE id = ?", input.attemptId);
      if (!stored) throw new Error("Failed to save the puzzle attempt");
      return toResult(stored);
    });
  },

  /** The current rating (its deviation widened for the time since the last rated attempt) and counts. */
  summary(now: number = Date.now()): PuzzleRatingSummary {
    const stored = storedRating();
    const rating = stored
      ? ratingAfterIdle({ rating: stored.rating, deviation: stored.rd, volatility: stored.volatility }, stored.last_rated_at, now)
      : DEFAULT_PUZZLE_RATING;
    const counts = get<{ attempts: number; solved: number | null }>(
      "SELECT COUNT(*) AS attempts, SUM(outcome = 'solved') AS solved FROM puzzle_attempts"
    );
    return {
      ...rating,
      provisional: isProvisional(rating),
      ratedCount: stored?.rated_count ?? 0,
      attemptCount: counts?.attempts ?? 0,
      solvedCount: counts?.solved ?? 0,
      lastRatedAt: stored?.last_rated_at ?? null
    };
  },

  /** The rating after each of the latest `limit` rated attempts, oldest first (in the order rated). */
  history(limit = 200): PuzzleRatingPoint[] {
    return all<{ at: number; rating: number }>(
      "SELECT decided_at AS at, rating_after AS rating FROM puzzle_attempts WHERE rated = 1 ORDER BY rowid DESC LIMIT ?",
      limit
    ).reverse();
  },

  /** Per theme, the rated attempts (first tries at Lichess puzzles): most played first. */
  themeStats(limit = 50): PuzzleThemeStat[] {
    return all<{ theme: string; attempts: number; solved: number; average: number | null }>(
      `SELECT theme.value AS theme, COUNT(*) AS attempts, SUM(attempt.outcome = 'solved') AS solved,
        AVG(attempt.puzzle_rating) AS average
      FROM puzzle_attempts attempt, json_each(attempt.themes_json) theme
      WHERE attempt.rated = 1
      GROUP BY theme.value
      ORDER BY attempts DESC, theme.value
      LIMIT ?`,
      limit
    ).map((row) => ({
      theme: row.theme,
      attempts: row.attempts,
      solved: row.solved,
      performance: row.average === null ? null : puzzlePerformance(row.average, row.solved, row.attempts)
    }));
  },

  /** Puzzles (of one source, or all) whose latest try failed, most recent failure first. */
  failed(sourceId: string | null, limit = 100): FailedPuzzle[] {
    return all<{ puzzle_id: string; source_id: string; database_id: string; decided_at: number; puzzle_rating: number | null }>(
      `SELECT attempt.puzzle_id, attempt.source_id, attempt.database_id, attempt.decided_at, attempt.puzzle_rating
      FROM puzzle_attempts attempt
      WHERE attempt.outcome = 'failed'
        AND (?1 IS NULL OR attempt.source_id = ?1)
        AND attempt.rowid = (
          SELECT MAX(latest.rowid) FROM puzzle_attempts latest
          WHERE latest.source_id = attempt.source_id AND latest.puzzle_id = attempt.puzzle_id
        )
      ORDER BY attempt.decided_at DESC
      LIMIT ?2`,
      sourceId,
      limit
    ).map((row) => ({
      puzzleId: row.puzzle_id,
      sourceId: row.source_id,
      databaseId: row.database_id,
      failedAt: row.decided_at,
      puzzleRating: row.puzzle_rating
    }));
  }
};
