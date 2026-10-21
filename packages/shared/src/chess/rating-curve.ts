import type { RatingCurve } from "../schemas/rating-curve";

/**
 * Maia rating curve interpretation: classifies the shape of (playedProb, bestProb) across the
 * curve's ratings (Maia 3's 21 points 600-2600, or a Maia 1 review's five levels 1100-1900) into
 * one label, which picks the fixed Maia note in headline.ts. The curve's low end is its lowest
 * two fifths of points (1100/1300 of Maia 1's five, 600-1300 of Maia 3's 21), its high end the
 * highest two fifths. Checks run in priority order (first match wins):
 *
 *   opening_principle             bestProb > 0.70 at every rating: the right move is
 *                                 universally found, pure principle.
 *   found_what_your_level_misses  played == best and playedProb at the player's rating < 0.30.
 *   trap_at_low_rating            playedProb high somewhere at the low end (> 0.70) and low all
 *                                 over the high end (< 0.30), played != best.
 *   rating_cliff                  playedProb crosses below 0.30 between two ratings;
 *                                 cliffRating is the first rating below.
 *   only_master_finds             bestProb > 0.60 at the top rating but < 0.30 at the lowest.
 *   your_level_blindspot          played != best and playedProb at the player's rating > 0.50.
 *   neutral                       no notable signal (or no curve to read).
 */

const HIGH_PLAYED_AT_LOW = 0.7;
const LOW_PLAYED_AT_HIGH = 0.3;
const HIGH_BEST_THRESHOLD = 0.7;
const ONLY_MASTER_THRESHOLD = 0.6;
const BLINDSPOT_PLAYED = 0.5;
const DIFFICULT_FIND_THRESHOLD = 0.3;
const CLIFF_THRESHOLD = 0.3;
/** A move Maia gives at least this probability is a likely one at that rating. */
const LIKELY_THRESHOLD = 0.3;
/** Share of the curve's points that make its low end, and its high end. */
const END_SHARE = 2 / 5;

export type InterpretInput = {
  /** Ascending; the probabilities are aligned with them. */
  ratings: readonly number[];
  playedProb: readonly number[];
  bestProb: readonly number[];
  playedIsBest: boolean;
  /** The player's rating: the curve's nearest rating stands for "your level". */
  userRating: number;
};

/** `cliffRating` is only set for "rating_cliff". */
export type InterpretResult = RatingCurve["interpretation"];

/**
 * Classify a rating curve into one of 7 interpretation labels.
 * Order of checks matters — strongest / most distinctive signals win.
 */
export function interpretRatingCurve(input: InterpretInput): InterpretResult {
  if (!isCurve(input)) return { label: "neutral" };
  const { ratings, playedProb, bestProb, playedIsBest } = input;
  const points = ratings.length;
  const userIndex = ratings.indexOf(nearestRating(ratings, input.userRating));

  // 1. Opening principle — bestProb saturated across every rating.
  if (bestProb.every((p) => p > HIGH_BEST_THRESHOLD)) {
    return { label: "opening_principle" };
  }

  // 2. Found what your level misses — player nailed a move most peers wouldn't.
  if (playedIsBest && playedProb[userIndex] < DIFFICULT_FIND_THRESHOLD) {
    return { label: "found_what_your_level_misses" };
  }

  // 3. Trap at low rating — high at the low end, low all over the high end.
  const endPoints = Math.max(1, Math.floor(points * END_SHARE));
  const playedAtLow = Math.max(...playedProb.slice(0, endPoints));
  const playedAtHigh = Math.max(...playedProb.slice(points - endPoints));
  if (playedAtLow > HIGH_PLAYED_AT_LOW && playedAtHigh < LOW_PLAYED_AT_HIGH && !playedIsBest) {
    return { label: "trap_at_low_rating" };
  }

  // 4. Rating cliff — played popularity decays past CLIFF_THRESHOLD somewhere on the curve.
  if (!playedIsBest) {
    const cliffIndex = crossingBelow(playedProb, CLIFF_THRESHOLD);
    if (cliffIndex !== null) {
      return { label: "rating_cliff", cliffRating: ratings[cliffIndex] };
    }
  }

  // 5. Only master finds — bestProb is only saturated at the top of the curve.
  if (bestProb[points - 1] > ONLY_MASTER_THRESHOLD && bestProb[0] < DIFFICULT_FIND_THRESHOLD) {
    return { label: "only_master_finds" };
  }

  // 6. Your level blindspot — player is at the rating where most peers play this mistake.
  if (!playedIsBest && playedProb[userIndex] > BLINDSPOT_PLAYED) {
    return { label: "your_level_blindspot" };
  }

  // 7. No notable signal.
  return { label: "neutral" };
}

/** At least two ratings, each with its played and best probability. */
function isCurve({ ratings, playedProb, bestProb }: InterpretInput): boolean {
  const points = ratings.length;
  return points >= 2 && playedProb.length === points && bestProb.length === points;
}

/** The first index where `probs` drops below `threshold` from at or above it; null without one. */
function crossingBelow(probs: readonly number[], threshold: number): number | null {
  for (let i = 1; i < probs.length; i += 1) {
    if (probs[i - 1] >= threshold && probs[i] < threshold) return i;
  }
  return null;
}

/**
 * The lowest rating from which `probs` stays at or above LIKELY_THRESHOLD all the way up the
 * curve: from what rating Maia expects the move. Undefined when it isn't likely at the top.
 */
function likelyFrom(ratings: readonly number[], probs: readonly number[]): number | undefined {
  let from: number | undefined;
  for (let i = probs.length - 1; i >= 0 && probs[i] >= LIKELY_THRESHOLD; i -= 1) from = ratings[i];
  return from;
}

/**
 * Assemble a complete RatingCurve from Maia's probabilities at each rating and the player's
 * rating: applies the interpretation classifier and returns the schema-shaped object.
 */
export function buildRatingCurve(input: InterpretInput): RatingCurve {
  const bestLikelyFrom = likelyFrom(input.ratings, input.bestProb);
  return {
    ratings: [...input.ratings],
    playedProb: [...input.playedProb],
    bestProb: [...input.bestProb],
    interpretation: interpretRatingCurve(input),
    userRatingBucket: nearestRating(input.ratings, input.userRating),
    ...(bestLikelyFrom === undefined ? {} : { bestLikelyFrom })
  };
}

/**
 * The rating of `ratings` nearest `rating`; a rating exactly between two (e.g. 1200 between
 * Maia 1's 1100 and 1300) maps to the lower one. `rating` itself when `ratings` is empty.
 */
export function nearestRating(ratings: readonly number[], rating: number): number {
  return ratings.reduce(
    (closest, candidate) =>
      Math.abs(rating - candidate) < Math.abs(rating - closest) ? candidate : closest,
    ratings[0] ?? rating
  );
}

/** The curve's played or best probability at `rating` (0 when the curve has no such rating). */
export function probFor(curve: RatingCurve, rating: number, which: "played" | "best"): number {
  const i = curve.ratings.indexOf(rating);
  if (i === -1) return 0;
  return which === "played" ? curve.playedProb[i] : curve.bestProb[i];
}
