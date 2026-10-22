import type { Color } from "@chaturanga/shared/types/chess";
import type { GameReview, MaiaCurveInput, MoveReview } from "@chaturanga/shared/types/engine";
import { nearestRating } from "@chaturanga/shared/chess/rating-curve";
import { nearestMaia3Rating } from "@chaturanga/shared/engine/maia3";
import { MAIA_BUCKETS } from "@chaturanga/shared/schemas/constants";
import { moverOf } from "./review-summary";

/**
 * A finished, saved Maia 3 review as the Engine tab reads it: where a move's rating curve is read
 * from, and the rating the review read each side at (`GameReview.maia`).
 */
export type MaiaCurveSource = {
  gameId: string;
  reviewId: string;
  ratings: Readonly<Record<Color, number>>;
};

/** The source for a saved review (null: not saved yet, still running, or not read with Maia 3). */
export function maiaCurveSource(
  gameId: string | null,
  review: Pick<GameReview, "reviewId" | "maia"> | null
): MaiaCurveSource | null {
  const maia = review?.maia;
  if (!gameId || !review?.reviewId || maia?.model !== "maia3") return null;
  return {
    gameId,
    reviewId: review.reviewId,
    ratings: { white: maia.white.rating, black: maia.black.rating }
  };
}

/**
 * The rating the move's Human moves are read at (and the curve marks). Maia 3 reads the mover at
 * their rating: the move's own prediction's, else (a move a partial Maia run missed) the review's
 * rating for the mover's side, at the curve's nearest point, whose prediction stands in for it.
 * Maia 1 reads the user at the level nearest `userRating`.
 */
export function markedRating(
  move: MoveReview,
  source: Pick<MaiaCurveSource, "ratings"> | null,
  userRating: number
): number {
  if (move.moverPrediction) return move.moverPrediction.rating;
  if (source) return nearestMaia3Rating(source.ratings[moverOf(move)]);
  return nearestRating(MAIA_BUCKETS, userRating);
}

/**
 * What to ask main for the move's Maia 3 curve: any move of a saved Maia 3 review whose curve isn't
 * saved with it, a move a partial Maia run missed (no prediction of its own) too, so it recovers
 * its curve and Human moves on demand. Null: nothing to ask.
 */
export function curveRequest(
  source: MaiaCurveSource | null,
  move: Pick<MoveReview, "nodeId">,
  hasCurve: boolean
): MaiaCurveInput | null {
  return source && !hasCurve
    ? { gameId: source.gameId, reviewId: source.reviewId, nodeId: move.nodeId }
    : null;
}
