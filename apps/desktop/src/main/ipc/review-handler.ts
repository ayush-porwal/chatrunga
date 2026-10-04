import type {
  AnalysePositionsInput,
  AnalysePositionsResult,
  EngineConfig,
  GameReview,
  ReviewGameInput
} from "@chaturanga/shared/types/engine";
import { existsSync } from "node:fs";
import { resolveReviewRating, type ReviewRating } from "@chaturanga/shared/chess/review-rating";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import { settingsRepository } from "../db/repositories";
import { errorMessage } from "../logger";
import { engineConfigForId, engineResourceOptions, listAllEngines } from "../engine/engine-config";
import type { EngineManager } from "../engine/engine-manager";
import { analysePositionsWithEngine, reviewGameWithEngine } from "../engine/review";
import { selectMaiaEnginesForReview } from "../engine/review-analysis";
import { getTelemetry } from "../telemetry";
import { engineFamily, plyBucket, reviewFailureCode } from "../telemetry/properties";

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
    ? input.predictionEngineIds
        .map(engineConfigForId)
        .filter((cfg): cfg is EngineConfig => Boolean(cfg))
    : settings.reviewUseMaia
      ? listAllEngines()
      : [];
  return selectMaiaEnginesForReview(
    candidates.filter((cfg) => cfg.id !== evaluationEngine.id && engineFilesExist(cfg)),
    settings.reviewMaiaLevels
  );
}

/**
 * The rating a review is made for (chess/review-rating.ts): the game's own for the reviewed side,
 * else the Settings one for its mode. Never asks Lichess. The Maia model is the nearest of the
 * levels this review runs (none when it runs no Maia).
 */
export function reviewRatingFor(
  input: Pick<ReviewGameInput, "rating" | "timeControl">,
  settings: Pick<AppSettings, "playerRatings" | "reviewPlayerColor">,
  maiaEngines: readonly { maiaRating: number }[]
): ReviewRating {
  const context = input.rating;
  return resolveReviewRating({
    side: context?.side ?? settings.reviewPlayerColor,
    gameRatings: context ? { white: context.whiteElo, black: context.blackElo } : null,
    timeControl: input.timeControl,
    speed: context?.speed ?? null,
    ratings: settings.playerRatings,
    installedMaiaModels: maiaEngines.map((engine) => engine.maiaRating)
  });
}

/**
 * Runs a full game review, streaming progress through EngineManager events
 * (relayed to the renderer) and resolving with the finished review.
 *
 * Usage analytics: one `review_started` and exactly one terminal event per operation (completed,
 * cancelled or failed), keyed by the operation's `reviewId`. Re-reviewing a game is a new
 * operation on the same `game_ref`; opening a saved review is never a completion.
 */
export async function runGameReview(
  engineManager: EngineManager,
  input: ReviewGameInput
): Promise<GameReview> {
  const config = engineConfigForId(input.engineId);
  if (!config) throw new Error("Engine not found");
  // Review knobs come from settings; an explicit `multipv` in the input wins.
  const settings = settingsRepository.getAll();
  const multipv = input.multipv && input.multipv > 0 ? input.multipv : settings.reviewMultiPv;
  const { reviewId } = input;
  const totalMoves = input.moves.length;
  const maiaEngines = maiaEnginesFor(input, config);
  const rating = reviewRatingFor(input, settings, maiaEngines);

  const telemetry = getTelemetry();
  const startedAt = performance.now();
  const operation = {
    review_id: reviewId,
    game_ref: telemetry?.gameRef(input.gameId) ?? undefined,
    ply_count: totalMoves,
    ply_bucket: plyBucket(totalMoves),
    engine_family: engineFamily(config),
    search_ms: input.moveTimeMs ?? undefined,
    multipv,
    maia_levels: maiaEngines.length
  };
  // Starting a review is a user action (Analyze).
  telemetry?.markActive("study");
  telemetry?.record("review_started", operation);

  engineManager.clearReviewCancellation(reviewId);
  engineManager.trackReview(reviewId, true);
  let movesDone = 0;
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
        onMoveCompleted: ({ moveIndex, move }) => {
          movesDone += 1;
          engineManager.emit("reviewMoveCompleted", { reviewId, moveIndex, totalMoves, move });
        },
        shouldCancel: () => engineManager.isReviewCancelled(reviewId)
      },
      maiaEngines,
      { ...engineResourceOptions(settings), playerRating: rating.rating }
    );
    // The operation id travels with the saved review, so opening it later is attributable; the
    // rating it was made for, so it shows where that came from.
    const finished: GameReview = { ...review, reviewId, rating };
    telemetry?.record("review_completed", {
      ...operation,
      duration_ms: Math.round(performance.now() - startedAt)
    });
    telemetry?.milestone("review_completed");
    engineManager.emit("reviewCompleted", { reviewId, review: finished });
    return finished;
  } catch (error) {
    const duration_ms = Math.round(performance.now() - startedAt);
    if (engineManager.isReviewCancelled(reviewId)) {
      telemetry?.record("review_cancelled", { ...operation, duration_ms, moves_done: movesDone });
    } else {
      telemetry?.record("review_failed", {
        ...operation,
        duration_ms,
        moves_done: movesDone,
        error_code: reviewFailureCode(error)
      });
    }
    engineManager.emit("reviewFailed", { reviewId, message: errorMessage(error) });
    throw error;
  } finally {
    engineManager.trackReview(reviewId, false);
    engineManager.clearReviewCancellation(reviewId);
  }
}

/**
 * Engine lines for a few single positions (the puzzle explanation), with the Game review engine
 * settings. Its own engine process, like a review, so live analysis and a running review carry on;
 * `cancelReview(requestId)` stops it (and quitting cancels it with the reviews).
 */
export async function runPositionAnalysis(
  engineManager: EngineManager,
  input: AnalysePositionsInput
): Promise<AnalysePositionsResult> {
  const config = engineConfigForId(input.engineId);
  if (!config) throw new Error("Engine not found");
  const { requestId } = input;
  // Unlike a review's, a cancel may come before the request reaches main (the user moved on at
  // once): it is kept, and only cleared once this request has finished.
  engineManager.trackReview(requestId, true);
  try {
    return await analysePositionsWithEngine(
      config,
      { positions: input.positions, moveTimeMs: input.moveTimeMs },
      { ...engineResourceOptions(), shouldCancel: () => engineManager.isReviewCancelled(requestId) }
    );
  } finally {
    engineManager.trackReview(requestId, false);
    engineManager.clearReviewCancellation(requestId);
  }
}
