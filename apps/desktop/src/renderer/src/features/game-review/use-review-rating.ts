import { useMemo } from "react";
import { resolveGameReviewRating, type ReviewRating } from "@chaturanga/shared/chess/review-rating";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import { RATING_MODE_LABELS } from "@chaturanga/shared/types/ratings";
import { REVIEW_MAIA_LEVELS, type AppSettings } from "@chaturanga/shared/types/settings";
import { useEnginesQuery } from "../../queries/api";
import { useGameStore } from "../../stores/game-store";
import { pickMaiaEngines } from "./review-engine-picker";

/** The Maia levels a review would run: the installed ones the settings select (none with Maia off). */
export function reviewMaiaModels(
  engines: readonly EngineConfig[],
  settings: Pick<AppSettings, "reviewUseMaia" | "reviewMaiaLevels">
): number[] {
  if (!settings.reviewUseMaia) return [];
  const installed = REVIEW_MAIA_LEVELS.filter((level) =>
    pickMaiaEngines(engines).some((engine) => engine.maiaRating === level)
  );
  const chosen = settings.reviewMaiaLevels;
  return chosen ? installed.filter((level) => chosen.includes(level)) : installed;
}

/**
 * The rating a review of the loaded game is made for, and where it comes from
 * (chess/review-rating.ts): what a review started now would use. A finished review says what it
 * was made for in `GameReview.rating`; show that one for it (`review?.rating ?? this`).
 */
export function useReviewRating(
  settings: Pick<
    AppSettings,
    "playerRatings" | "reviewPlayerColor" | "reviewUseMaia" | "reviewMaiaLevels"
  >
): ReviewRating {
  const headers = useGameStore((state) => state.headers);
  const source = useGameStore((state) => state.source);
  const engines = useEnginesQuery();
  const { playerRatings, reviewPlayerColor, reviewUseMaia, reviewMaiaLevels } = settings;
  return useMemo(
    () =>
      resolveGameReviewRating({
        headers,
        source,
        side: reviewPlayerColor,
        ratings: playerRatings,
        installedMaiaModels: reviewMaiaModels(engines.data ?? [], {
          reviewUseMaia,
          reviewMaiaLevels
        })
      }),
    [
      headers,
      source,
      reviewPlayerColor,
      playerRatings,
      engines.data,
      reviewUseMaia,
      reviewMaiaLevels
    ]
  );
}

/** "1533 · from the game", "Rapid 1500 · from Settings", with "→ Maia 1100" when it rounds. */
export function reviewRatingLabel(rating: ReviewRating): string {
  const base =
    rating.source === "game"
      ? `${rating.rating} · from the game`
      : `${RATING_MODE_LABELS[rating.mode]} ${rating.rating} · from Settings`;
  return rating.maiaModel !== null && rating.maiaModel !== rating.rating
    ? `${base} → Maia ${rating.maiaModel}`
    : base;
}
