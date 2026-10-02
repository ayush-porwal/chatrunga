import { useCallback } from "react";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import { mainlineReviewInput } from "../features/game-review/review-utils";
import { pickDefaultEngine } from "../features/game-review/review-engine-picker";
import { useGameStore } from "../stores/game-store";
import { useReviewStore } from "../stores/review-store";
import { ipcErrorMessage } from "@/lib/ipc-error";

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
  // Only "is there a main line?" is rendered; the game itself is read when a review starts, so the
  // app shell does not re-render on every move.
  const hasMoves = useGameStore((state) => hasMainlineMove(state.moveTree));
  const { defaultEngineId, reviewUseMaia, reviewSearchTimeMs } = settings;

  const startReview = useCallback(async () => {
    const review = useReviewStore.getState();
    if (!window.chaturanga) {
      review.setError("Game Review needs the desktop app to run the engine.");
      return;
    }
    const { moveTree, rootFen, headers } = useGameStore.getState();
    const reviewInput = mainlineReviewInput(moveTree);
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
    // A game reviewed before its first save gets its library id now (autosave keeps it), so the
    // review and the saved game it belongs to share one id. Never a puzzle: it isn't saved.
    const game = useGameStore.getState();
    let gameId = game.gameId;
    if (!gameId && game.mode !== "puzzle" && game.source !== "puzzle") {
      gameId = crypto.randomUUID();
      useGameStore.getState().setGameId(gameId);
    }
    review.startReview(reviewId);
    try {
      await window.chaturanga.engines.reviewGame({
        reviewId,
        gameId,
        engineId: engine.id,
        // Omitted ids let main pick every installed Maia filtered by `reviewMaiaLevels`;
        // an empty list turns Maia off for this review.
        ...(reviewUseMaia ? {} : { predictionEngineIds: [] }),
        rootFen,
        moves: reviewInput,
        moveTimeMs: reviewSearchTimeMs,
        timeControl: headers.timeControl ?? null
      });
    } catch (error) {
      // The invoke error wraps main's message; a cancelled review (or one replaced by another
      // game's) is not an error to show.
      const message = ipcErrorMessage(error) || String(error);
      if (message !== REVIEW_CANCELLED && useReviewStore.getState().reviewId === reviewId) {
        useReviewStore.getState().setError(message);
      }
    }
  }, [defaultEngineId, engines, gameLoading, onEngineMissing, reviewSearchTimeMs, reviewUseMaia]);

  return { startReview, hasMoves };
}

/** Whether the game has at least one main-line move (the root has a child). */
function hasMainlineMove(moveTree: readonly { parentId: string | null; children: string[] }[]): boolean {
  const root = moveTree.find((node) => node.parentId === null);
  return Boolean(root?.children.length);
}
