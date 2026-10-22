import { z } from "zod";

/**
 * Maia rating curve: at each rating Maia was read at (Maia 3's 21 points 600-2600, or a Maia 1
 * review's five levels 1100-1900), the policy probability of the played move and of the engine's
 * best move. The classifier in chess/rating-curve.ts turns the two curves into one interpretation
 * label, which picks the fixed Maia note (chess/headline.ts) shown in Game Review.
 */

/** A rating Maia was read at. */
export const maiaRatingSchema = z.number().int().min(100).max(3500);

const probability = z.number().min(0).max(1);
/** Maia 3's 21 rating points are the most a curve has; two are the fewest that make a curve. */
const curvePoints = <T extends z.ZodTypeAny>(item: T) => z.array(item).min(2).max(21);

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
  /** Only set when label === "rating_cliff" — the first rating where playedProb is below 0.30. */
  cliffRating: maiaRatingSchema.optional()
});

export const ratingCurveSchema = z
  .object({
    /** Ascending; `playedProb[i]` / `bestProb[i]` are Maia's probabilities at `ratings[i]`. */
    ratings: curvePoints(maiaRatingSchema),
    playedProb: curvePoints(probability),
    bestProb: curvePoints(probability),
    interpretation: ratingCurveInterpretationSchema,
    /** The curve's rating that reads for the player's level (Maia 3: the mover's rating). */
    userRatingBucket: maiaRatingSchema,
    /** The lowest rating from which the best move keeps at least a 30% probability up the curve. */
    bestLikelyFrom: maiaRatingSchema.optional()
  })
  .superRefine((curve, context) => {
    const points = curve.ratings.length;
    if (curve.playedProb.length !== points || curve.bestProb.length !== points)
      context.addIssue({ code: "custom", message: "One probability per rating" });
    if (curve.ratings.some((rating, index) => index > 0 && rating <= curve.ratings[index - 1]))
      context.addIssue({ code: "custom", message: "Ratings must ascend" });
    if (!curve.ratings.includes(curve.userRatingBucket))
      context.addIssue({ code: "custom", message: "The player's rating must be on the curve" });
  });

export type RatingCurve = z.infer<typeof ratingCurveSchema>;
