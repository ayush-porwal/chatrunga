import { MAIA_BUCKETS, type MaiaRatingBucket, type RatingCurve } from "../schemas/rating-curve";

/**
 * Maia rating curve interpretation: classifies the shape of (playedProb, bestProb)
 * across the five rating buckets into one label, which picks the fixed Maia
 * note in headline.ts. Checks run in priority order (first match wins):
 *
 *   opening_principle             bestProb > 0.70 at every bucket: the right move is
 *                                 universally found, pure principle.
 *   found_what_your_level_misses  played == best and playedProb[userBucket] < 0.30.
 *   trap_at_low_rating            playedProb high at 1100/1300 (> 0.70) and low at
 *                                 1700/1900 (< 0.30), played != best.
 *   rating_cliff                  playedProb crosses below 0.30 between two buckets;
 *                                 cliffRating is the first bucket below.
 *   only_master_finds             bestProb > 0.60 at 1900 but < 0.30 at 1100.
 *   your_level_blindspot          played != best and playedProb[userBucket] > 0.50.
 *   neutral                       no notable signal.
 */

const HIGH_PLAYED_AT_LOW = 0.7;
const LOW_PLAYED_AT_HIGH = 0.3;
const HIGH_BEST_THRESHOLD = 0.7;
const ONLY_MASTER_THRESHOLD = 0.6;
const BLINDSPOT_PLAYED = 0.5;
const DIFFICULT_FIND_THRESHOLD = 0.3;
const CLIFF_THRESHOLD = 0.3;

export type InterpretInput = {
  playedProb: readonly [number, number, number, number, number];
  bestProb: readonly [number, number, number, number, number];
  playedIsBest: boolean;
  userBucket: MaiaRatingBucket;
};

/** `cliffRating` is only set for "rating_cliff". */
export type InterpretResult = RatingCurve["interpretation"];

/**
 * Classify a rating curve into one of 7 interpretation labels.
 * Order of checks matters — strongest / most distinctive signals win.
 */
export function interpretRatingCurve(input: InterpretInput): InterpretResult {
  const { playedProb, bestProb, playedIsBest, userBucket } = input;
  const userIndex = MAIA_BUCKETS.indexOf(userBucket);

  // 1. Opening principle — bestProb saturated across every rating.
  if (bestProb.every((p) => p > HIGH_BEST_THRESHOLD)) {
    return { label: "opening_principle" };
  }

  // 2. Found what your level misses — player nailed a move most peers wouldn't.
  if (playedIsBest && userIndex >= 0 && playedProb[userIndex] < DIFFICULT_FIND_THRESHOLD) {
    return { label: "found_what_your_level_misses" };
  }

  // 3. Trap at low rating — high at low buckets, drops sharply at high buckets.
  const playedAtLow = Math.max(playedProb[0], playedProb[1]);
  const playedAtHigh = Math.max(playedProb[3], playedProb[4]);
  if (playedAtLow > HIGH_PLAYED_AT_LOW && playedAtHigh < LOW_PLAYED_AT_HIGH && !playedIsBest) {
    return { label: "trap_at_low_rating" };
  }

  // 4. Rating cliff — played popularity decays past CLIFF_THRESHOLD somewhere on the ladder.
  if (!playedIsBest) {
    const cliffBucket = findCliffBucket(playedProb);
    if (cliffBucket !== null) {
      return { label: "rating_cliff", cliffRating: cliffBucket };
    }
  }

  // 5. Only master finds — bestProb is only saturated at the top of the ladder.
  if (bestProb[4] > ONLY_MASTER_THRESHOLD && bestProb[0] < DIFFICULT_FIND_THRESHOLD) {
    return { label: "only_master_finds" };
  }

  // 6. Your level blindspot — player is in the bucket where most peers play this mistake.
  if (!playedIsBest && userIndex >= 0 && playedProb[userIndex] > BLINDSPOT_PLAYED) {
    return { label: "your_level_blindspot" };
  }

  // 7. No notable signal.
  return { label: "neutral" };
}

/**
 * Find the rating bucket where playedProb first drops below CLIFF_THRESHOLD.
 * Returns null when no clean crossover exists.
 */
function findCliffBucket(playedProb: readonly number[]): MaiaRatingBucket | null {
  for (let i = 1; i < playedProb.length; i += 1) {
    if (playedProb[i - 1] >= CLIFF_THRESHOLD && playedProb[i] < CLIFF_THRESHOLD) {
      return MAIA_BUCKETS[i];
    }
  }
  return null;
}

/**
 * Assemble a complete RatingCurve from raw Maia probability data and the player's bucket.
 * Caller passes the parallel five-tuples from multi-Maia analysis; this function
 * applies the interpretation classifier and returns the schema-shaped object.
 */
export function buildRatingCurve(input: InterpretInput): RatingCurve {
  const interpretation = interpretRatingCurve(input);
  return {
    ratings: [...MAIA_BUCKETS] as unknown as RatingCurve["ratings"],
    playedProb: [...input.playedProb] as RatingCurve["playedProb"],
    bestProb: [...input.bestProb] as RatingCurve["bestProb"],
    interpretation,
    userRatingBucket: input.userBucket
  };
}

/**
 * Nearest Maia bucket for an arbitrary Elo; a rating exactly between two
 * buckets (e.g. 1200) maps to the lower one.
 */
export function quantizeToBucket(rating: number): MaiaRatingBucket {
  return MAIA_BUCKETS.reduce<MaiaRatingBucket>(
    (closest, bucket) =>
      Math.abs(rating - bucket) < Math.abs(rating - closest) ? bucket : closest,
    MAIA_BUCKETS[0]
  );
}

/** Index into the parallel `playedProb`/`bestProb` arrays by bucket. */
export function probFor(
  curve: RatingCurve,
  bucket: MaiaRatingBucket,
  which: "played" | "best"
): number {
  const i = MAIA_BUCKETS.indexOf(bucket);
  if (i === -1) return 0;
  return which === "played" ? curve.playedProb[i] : curve.bestProb[i];
}
