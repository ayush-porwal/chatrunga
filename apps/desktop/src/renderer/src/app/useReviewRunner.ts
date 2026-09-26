import { useCallback, useMemo } from "react";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import { mainlineReviewInput } from "../features/game-review/review-utils";
import { pickDefaultEngine } from "../features/game-review/review-engine-picker";
import { useGameStore } from "../stores/game-store";
import { useReviewStore } from "../stores/review-store";

const REVIEW_CANCELLED = "Review cancelled";

/** Stops the running engine review, if any. Safe to call when none is running. */
export async function cancelActiveReview(): Promise<void> {
  const reviewId = useReviewStore.getState().reviewId;
  if (!reviewId) return;
  try {
    await window.chaturanga?.engines.cancelReview(reviewId);
  } catch {
    // Navigation/reset should still succeed if the old review already ended.
  }
}

/**
 * Starts an engine review of the loaded game's main line. Progress and results stream into the
 * review store through useReviewEventSubscription.
 */
export function useReviewRunner({
  engines,
  settings,
  gameLoading,
  onEngineMissing
}: {
  engines: readonly EngineConfig[] | undefined;
  settings: AppSettings;
  /** The review route's game is still loading: reviewing now would analyse the previous game. */
  gameLoading: boolean;
  /** No usable evaluation engine: the user has to pick one in Review settings. */
  onEngineMissing: () => void;
}): { startReview: () => Promise<void>; hasMoves: boolean } {
  const moveTree = useGameStore((state) => state.moveTree);
  const rootFen = useGameStore((state) => state.rootFen);
  const timeControl = useGameStore((state) => state.headers.timeControl ?? null);
  const reviewInput = useMemo(() => mainlineReviewInput(moveTree), [moveTree]);
  const { defaultEngineId, reviewUseMaia, reviewSearchTimeMs } = settings;

  const startReview = useCallback(async () => {
    const review = useReviewStore.getState();
    if (!window.chaturanga) {
      review.setError("Game Review needs the desktop app to run the engine.");
      return;
    }
    // Nothing to review: the UI offers import / new game instead of Analyze.
    if (!reviewInput.length) return;
    if (gameLoading) {
      review.setError("Loading the selected game…");
      return;
    }
    const engine = defaultEngineId
      ? engines?.find((item) => item.id === defaultEngineId)
      : pickDefaultEngine(engines ?? []);
    if (!engine?.isAvailable || engine.isHumanPrediction) {
      review.setError("Choose an available evaluation engine in Review settings first.");
      onEngineMissing();
      return;
    }
    const reviewId = crypto.randomUUID();
    review.startReview(reviewId);
    try {
      await window.chaturanga.engines.reviewGame({
        reviewId,
        engineId: engine.id,
        // Omitted ids let main pick every installed Maia filtered by `reviewMaiaLevels`;
        // an empty list turns Maia off for this review.
        ...(reviewUseMaia ? {} : { predictionEngineIds: [] }),
        rootFen,
        moves: reviewInput,
        moveTimeMs: reviewSearchTimeMs,
        timeControl
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== REVIEW_CANCELLED) useReviewStore.getState().setError(message);
    }
  }, [defaultEngineId, engines, gameLoading, onEngineMissing, reviewInput, reviewSearchTimeMs, reviewUseMaia, rootFen, timeControl]);

  return { startReview, hasMoves: reviewInput.length > 0 };
}
