import { z } from "zod";

/**
 * Maia rating curve: for each of the five Maia models (1100-1900), the policy
 * probability of the played move and of the engine's best move. The classifier
 * in chess/rating-curve.ts turns the two curves into one interpretation label,
 * which picks the fixed Maia note (chess/headline.ts) shown in Game Review.
 */

export const maiaRatingBucketSchema = z.union([
  z.literal(1100),
  z.literal(1300),
  z.literal(1500),
  z.literal(1700),
  z.literal(1900)
]);

export type MaiaRatingBucket = z.infer<typeof maiaRatingBucketSchema>;

/** Fixed five-rating ladder used everywhere. Order matters: indexes are aligned. */
export const MAIA_BUCKETS = [1100, 1300, 1500, 1700, 1900] as const;

const probability = z.number().min(0).max(1);
const probabilityFiveTuple = z.tuple([
  probability,
  probability,
  probability,
  probability,
  probability
]);

const ratingCurveInterpretationLabelSchema = z.enum([
  "trap_at_low_rating",
  "rating_cliff",
  "only_master_finds",
  "your_level_blindspot",
  "found_what_your_level_misses",
  "opening_principle",
  "neutral"
]);

const ratingCurveInterpretationSchema = z.object({
  label: ratingCurveInterpretationLabelSchema,
  /** Only set when label === "rating_cliff" — the rating at which playedProb first crosses below 0.30. */
  cliffRating: maiaRatingBucketSchema.optional()
});

export const ratingCurveSchema = z.object({
  ratings: z.tuple([
    z.literal(1100),
    z.literal(1300),
    z.literal(1500),
    z.literal(1700),
    z.literal(1900)
  ]),
  playedProb: probabilityFiveTuple,
  bestProb: probabilityFiveTuple,
  interpretation: ratingCurveInterpretationSchema,
  userRatingBucket: maiaRatingBucketSchema
});

export type RatingCurve = z.infer<typeof ratingCurveSchema>;
