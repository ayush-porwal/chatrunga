import type { GameReview } from "@chaturanga/shared/types/engine";
import type { SavedReviewInfo } from "@chaturanga/shared/types/chess";
import { savedReviewInfo } from "@chaturanga/shared/chess/review-info";

/** A saved analysis (table `game_reviews`): the review JSON plus what's needed to list it. */
export type GameReviewRow = {
  review_id: string;
  game_id: string;
  created_at: number;
  engine_name: string | null;
  move_time_ms: number | null;
  depth: number | null;
  maia_levels_json: string;
  move_count: number;
  commentary_count: number;
  review_json: string;
};

/** The listing columns of a review (everything but the ids and the JSON). */
export function reviewListingFields(review: GameReview) {
  const info = savedReviewInfo(review, "");
  return {
    created_at: info.createdAt,
    engine_name: info.engineName,
    move_time_ms: info.moveTimeMs,
    depth: info.depth,
    maia_levels_json: JSON.stringify(info.maiaLevels),
    move_count: info.moveCount,
    commentary_count: info.commentaryCount
  };
}

export function toSavedReviewInfo(row: Omit<GameReviewRow, "game_id" | "review_json">): SavedReviewInfo {
  let maiaLevels: number[] = [];
  try {
    const parsed: unknown = JSON.parse(row.maia_levels_json);
    if (Array.isArray(parsed)) maiaLevels = parsed.filter((value): value is number => Number.isInteger(value));
  } catch {
    maiaLevels = [];
  }
  return {
    reviewId: row.review_id,
    createdAt: row.created_at,
    engineName: row.engine_name,
    moveTimeMs: row.move_time_ms,
    depth: row.depth,
    maiaLevels,
    moveCount: row.move_count,
    commentaryCount: row.commentary_count
  };
}

/** A review's id for its row: the run's id, or a stable one for a review saved before runs had ids. */
export function reviewRowId(review: GameReview, gameId: string): string {
  return review.reviewId?.trim() || `legacy-${gameId}-${review.createdAt}`;
}
