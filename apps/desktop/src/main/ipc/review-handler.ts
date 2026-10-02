import type { EngineConfig, GameReview, ReviewGameInput } from "@chaturanga/shared/types/engine";
import { existsSync } from "node:fs";
import { settingsRepository } from "../db/repositories";
import { errorMessage } from "../logger";
import { engineConfigForId, engineResourceOptions, listAllEngines } from "../engine/engine-config";
import type { EngineManager } from "../engine/engine-manager";
import { reviewGameWithEngine } from "../engine/review";
import { selectMaiaEnginesForReview } from "../engine/review-analysis";

/** Executable (and weights, when set) are on disk. */
function engineFilesExist(config: EngineConfig): boolean {
  if (!config.executablePath || !existsSync(config.executablePath)) return false;
  return !config.weightsPath || existsSync(config.weightsPath);
}

/**
 * Maia engines for a review: explicit ids are filtered to runnable engines;
 * omitted ids mean "every installed Maia" when the setting is on; an empty
 * array disables Maia. Levels come from the `reviewMaiaLevels` setting.
 */
function maiaEnginesFor(input: ReviewGameInput, evaluationEngine: EngineConfig) {
  const settings = settingsRepository.getAll();
  const candidates = input.predictionEngineIds
    ? input.predictionEngineIds.map(engineConfigForId).filter((cfg): cfg is EngineConfig => Boolean(cfg))
    : settings.reviewUseMaia
      ? listAllEngines()
      : [];
  return selectMaiaEnginesForReview(
    candidates.filter((cfg) => cfg.id !== evaluationEngine.id && engineFilesExist(cfg)),
    settings.reviewMaiaLevels
  );
}

/**
 * Runs a full game review, streaming progress through EngineManager events
 * (relayed to the renderer) and resolving with the finished review.
 */
export async function runGameReview(engineManager: EngineManager, input: ReviewGameInput): Promise<GameReview> {
  const config = engineConfigForId(input.engineId);
  if (!config) throw new Error("Engine not found");
  // Review knobs come from settings; an explicit `multipv` in the input wins.
  const settings = settingsRepository.getAll();
  const multipv = input.multipv && input.multipv > 0 ? input.multipv : settings.reviewMultiPv;
  const { reviewId } = input;
  const totalMoves = input.moves.length;

  engineManager.clearReviewCancellation(reviewId);
  engineManager.trackReview(reviewId, true);
  try {
    const review = await reviewGameWithEngine(
      config,
      { ...input, multipv },
      {
        onPhaseProgress: (progress) =>
          engineManager.emit("reviewProgress", {
            reviewId,
            totalMoves,
            playedUci: input.moves[progress.moveIndex]?.uci ?? "",
            ...progress
          }),
        onMoveCompleted: ({ moveIndex, move }) =>
          engineManager.emit("reviewMoveCompleted", { reviewId, moveIndex, totalMoves, move }),
        shouldCancel: () => engineManager.isReviewCancelled(reviewId)
      },
      maiaEnginesFor(input, config),
      { ...engineResourceOptions(settings), playerRating: settings.reviewPlayerRating }
    );
    engineManager.emit("reviewCompleted", { reviewId, review });
    return review;
  } catch (error) {
    engineManager.emit("reviewFailed", { reviewId, message: errorMessage(error) });
    throw error;
  } finally {
    engineManager.trackReview(reviewId, false);
    engineManager.clearReviewCancellation(reviewId);
  }
}
