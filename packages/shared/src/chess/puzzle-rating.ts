/**
 * The local puzzle rating, scored like Lichess's: every first try at a rated (Lichess database)
 * puzzle is a Glicko-2 game between the solver and the puzzle — a clean solve wins, a failure
 * loses. The puzzle's own rating is never changed. Constants follow Lichess's puzzle perf.
 */
import { GLICKO2_SCALE, glicko2Update, type Glicko2Rating } from "./glicko2";

/** A new solver, as Lichess starts one. */
export const DEFAULT_PUZZLE_RATING: Glicko2Rating = {
  rating: 1500,
  deviation: 500,
  volatility: 0.09
};
/** τ of the volatility update. */
export const PUZZLE_RATING_TAU = 0.75;
/** The deviation stays within these bounds, and the volatility at most MAX_VOLATILITY. */
export const MIN_DEVIATION = 45;
export const MAX_DEVIATION = 500;
export const MAX_VOLATILITY = 0.1;
/** A rating this uncertain is provisional (Lichess shows it with a "?"). */
export const PROVISIONAL_DEVIATION = 110;
/** Rating periods per day of inactivity, which widen the deviation (Lichess's calculator). */
export const RATING_PERIODS_PER_DAY = 0.21436;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isProvisional(rating: Pick<Glicko2Rating, "deviation">): boolean {
  return rating.deviation >= PROVISIONAL_DEVIATION;
}

/**
 * The rating as of `at`, its deviation widened for the time since the last rated attempt
 * (`lastRatedAt`): φ² + σ²·periods, periods counted in days × RATING_PERIODS_PER_DAY. Unchanged
 * without a previous attempt or when the clock went backwards.
 */
export function ratingAfterIdle(
  rating: Glicko2Rating,
  lastRatedAt: number | null,
  at: number
): Glicko2Rating {
  if (lastRatedAt === null || !(at > lastRatedAt)) return rating;
  const periods = ((at - lastRatedAt) / DAY_MS) * RATING_PERIODS_PER_DAY;
  // σ is in the Glicko-2 scale; the deviation in the Glicko one.
  const sigmaGlicko = rating.volatility * GLICKO2_SCALE;
  const deviation = Math.sqrt(rating.deviation ** 2 + sigmaGlicko ** 2 * periods);
  return { ...rating, deviation: clamp(deviation, MIN_DEVIATION, MAX_DEVIATION) };
}

/**
 * The solver's rating after one try at a puzzle (`solved`: a clean solve), the deviation first
 * widened for the idle time since `lastRatedAt`. The result's deviation and volatility are held to
 * the bounds above.
 */
export function rateAttempt(
  rating: Glicko2Rating,
  puzzle: { rating: number; deviation: number },
  solved: boolean,
  at: number,
  lastRatedAt: number | null = null
): Glicko2Rating {
  const before = ratingAfterIdle(sanitize(rating), lastRatedAt, at);
  const after = glicko2Update(
    before,
    [
      {
        opponent: {
          rating: puzzle.rating,
          deviation: clamp(puzzle.deviation, MIN_DEVIATION, MAX_DEVIATION)
        },
        score: solved ? 1 : 0
      }
    ],
    PUZZLE_RATING_TAU
  );
  return {
    rating: after.rating,
    deviation: clamp(after.deviation, MIN_DEVIATION, MAX_DEVIATION),
    volatility: Math.min(after.volatility, MAX_VOLATILITY)
  };
}

/** A stored rating that isn't usable (NaN, out of bounds) falls back to the defaults, field by field. */
function sanitize(rating: Glicko2Rating): Glicko2Rating {
  return {
    rating: Number.isFinite(rating.rating) ? rating.rating : DEFAULT_PUZZLE_RATING.rating,
    deviation: Number.isFinite(rating.deviation)
      ? clamp(rating.deviation, MIN_DEVIATION, MAX_DEVIATION)
      : DEFAULT_PUZZLE_RATING.deviation,
    volatility:
      Number.isFinite(rating.volatility) && rating.volatility > 0
        ? Math.min(rating.volatility, MAX_VOLATILITY)
        : DEFAULT_PUZZLE_RATING.volatility
  };
}

/**
 * Performance over a group of puzzles, as Lichess's puzzle dashboard computes it: the puzzles'
 * average rating − 500, plus 1000 × the share solved (all solved: average + 500). Null without any.
 */
export function puzzlePerformance(
  averagePuzzleRating: number,
  solved: number,
  attempts: number
): number | null {
  if (attempts <= 0 || !Number.isFinite(averagePuzzleRating)) return null;
  return Math.round(averagePuzzleRating - 500 + (1000 * solved) / attempts);
}

/** Lichess's puzzle difficulties: puzzles rated this far from the solver's rating. */
export const PUZZLE_DIFFICULTIES = [
  { id: "easiest", label: "Easiest", offset: -600 },
  { id: "easier", label: "Easier", offset: -300 },
  { id: "normal", label: "Normal", offset: 0 },
  { id: "harder", label: "Harder", offset: 300 },
  { id: "hardest", label: "Hardest", offset: 600 }
] as const;

export type PuzzleDifficulty = (typeof PUZZLE_DIFFICULTIES)[number]["id"];

export function isPuzzleDifficulty(value: unknown): value is PuzzleDifficulty {
  return PUZZLE_DIFFICULTIES.some((difficulty) => difficulty.id === value);
}

/** Puzzles within this many points of the target rating are drawn. */
export const AROUND_RATING_WINDOW = 150;
/**
 * Where the target is kept: roughly the Lichess set's rating span, so an "easiest" set for a new
 * or low-rated solver (or "hardest" for a very strong one) still finds puzzles.
 */
const TARGET_MIN = 600;
const TARGET_MAX = 3000;

/** The rating range of a difficulty around the solver's rating (whole numbers). */
export function ratingRangeFor(
  rating: number,
  difficulty: PuzzleDifficulty
): { ratingMin: number; ratingMax: number } {
  const offset = PUZZLE_DIFFICULTIES.find((item) => item.id === difficulty)?.offset ?? 0;
  const base = Number.isFinite(rating) ? rating : DEFAULT_PUZZLE_RATING.rating;
  const target = Math.round(clamp(base + offset, TARGET_MIN, TARGET_MAX));
  return { ratingMin: target - AROUND_RATING_WINDOW, ratingMax: target + AROUND_RATING_WINDOW };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
