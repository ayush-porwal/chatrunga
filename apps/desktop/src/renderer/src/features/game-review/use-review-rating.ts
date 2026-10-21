import { useMemo } from "react";
import {
  lichessSpeedFromHeaders,
  resolveGameReviewRating,
  resolveReviewSideRatings,
  type ReviewRating
} from "@chaturanga/shared/chess/review-rating";
import type { ReviewSideRating } from "@chaturanga/shared/types/engine";
import { RATING_MODE_LABELS } from "@chaturanga/shared/types/ratings";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import { useGameStore } from "../../stores/game-store";

/**
 * The rating a review of the loaded game is made for, and where it comes from
 * (chess/review-rating.ts): what a review started now would use. A finished review says what it
 * was made for in `GameReview.rating`; show that one for it (`review?.rating ?? this`).
 * `side`: the side the game is reviewed as (review-side.ts); the Settings side without one.
 */
export function useReviewRating(
  settings: Pick<AppSettings, "playerRatings" | "reviewPlayerColor">,
  side?: "white" | "black"
): ReviewRating {
  const headers = useGameStore((state) => state.headers);
  const source = useGameStore((state) => state.source);
  const { playerRatings } = settings;
  const reviewPlayerColor = side ?? settings.reviewPlayerColor;
  return useMemo(
    () =>
      resolveGameReviewRating({ headers, source, side: reviewPlayerColor, ratings: playerRatings }),
    [headers, source, reviewPlayerColor, playerRatings]
  );
}

/** "1533 · from the game", "Rapid 1500 · from Settings". */
export function reviewRatingLabel(rating: ReviewRating): string {
  return rating.source === "game"
    ? `${rating.rating} · from the game`
    : `${RATING_MODE_LABELS[rating.mode]} ${rating.rating} · from Settings`;
}

type SideRatings = { white: ReviewSideRating; black: ReviewSideRating };

/**
 * The ratings Maia 3 would read each side of the loaded game at (chess/review-rating.ts): the
 * Review-settings rating for both, else each side's game rating, else the user's for the game's mode.
 */
export function useReviewSideRatings(
  settings: Pick<AppSettings, "playerRatings" | "reviewMaiaRating">
): SideRatings {
  const headers = useGameStore((state) => state.headers);
  const source = useGameStore((state) => state.source);
  const { playerRatings, reviewMaiaRating } = settings;
  return useMemo(
    () =>
      resolveReviewSideRatings({
        gameRatings: { white: headers.whiteElo, black: headers.blackElo },
        timeControl: headers.timeControl,
        speed: lichessSpeedFromHeaders(headers, source),
        ratings: playerRatings,
        override: reviewMaiaRating
      }),
    [headers, source, playerRatings, reviewMaiaRating]
  );
}

const SOURCE_LABELS: Record<ReviewSideRating["source"], string> = {
  game: "the game",
  settings: "Settings",
  override: "Review settings"
};

/**
 * Both sides' Maia ratings in one line: "Both sides 1800" (the Review-settings rating), "White
 * 1500 · Black 1700 · from the game", or each side's source when they differ.
 */
export function sideRatingsLabel({ white, black }: SideRatings): string {
  if (white.source === "override" && black.source === "override")
    return `Both sides ${white.rating}`;
  if (white.source === black.source)
    return `White ${white.rating} · Black ${black.rating} · from ${SOURCE_LABELS[white.source]}`;
  return `White ${white.rating} (${SOURCE_LABELS[white.source]}) · Black ${black.rating} (${SOURCE_LABELS[black.source]})`;
}
