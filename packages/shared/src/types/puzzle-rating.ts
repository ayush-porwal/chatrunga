/** The local puzzle rating and attempt history (main/db/puzzle-attempts.ts; scoring in chess/puzzle-rating.ts). */
import type { Glicko2Rating } from "../chess/glicko2";

/** A decided try at a puzzle, as the renderer reports it (once decided; again when completed). */
export type RecordPuzzleAttemptInput = {
  /** The attempt's own id: recording it again changes nothing but a newly known `completedAt`. */
  attemptId: string;
  puzzleId: string;
  databaseId: string;
  sourceId: string;
  outcome: "solved" | "failed";
  /** The puzzle's Lichess rating and deviation (null for unrated sets). */
  puzzleRating: number | null;
  puzzleRatingDeviation: number | null;
  themes: string[];
  wrongMoveCount: number;
  solutionViewed: boolean;
  startedAt: number;
  decidedAt: number;
  completedAt: number | null;
};

/**
 * Why an attempt didn't change the rating: the puzzle has no Lichess rating (the position set),
 * or it was tried before (only the first try at a puzzle counts, as on Lichess).
 */
export type PuzzleUnratedReason = "unrated-puzzle" | "already-played";
export const PUZZLE_UNRATED_REASONS: readonly PuzzleUnratedReason[] = [
  "unrated-puzzle",
  "already-played"
];

export type PuzzleAttemptResult = {
  attemptId: string;
  rated: boolean;
  unratedReason: PuzzleUnratedReason | null;
  /** The solver's rating before and after (rated attempts only). */
  before: Glicko2Rating | null;
  after: Glicko2Rating | null;
  /** after − before, rounded as shown (rated attempts only). */
  delta: number | null;
};

export type PuzzleRatingSummary = Glicko2Rating & {
  provisional: boolean;
  /** Rated attempts (each a first try at a Lichess puzzle). */
  ratedCount: number;
  /** Every recorded attempt, and how many of them were solved cleanly. */
  attemptCount: number;
  solvedCount: number;
  lastRatedAt: number | null;
};

/** The rating after a rated attempt, oldest first. */
export type PuzzleRatingPoint = { at: number; rating: number };

/** First tries at rated puzzles with this theme. */
export type PuzzleThemeStat = {
  theme: string;
  attempts: number;
  solved: number;
  /** Lichess's dashboard performance (see puzzlePerformance). */
  performance: number | null;
};

/** A puzzle whose latest try failed, to try again. */
export type FailedPuzzle = {
  puzzleId: string;
  sourceId: string;
  databaseId: string;
  failedAt: number;
  puzzleRating: number | null;
};
