import type {
  AnalysePositionsInput,
  AnalysePositionsResult,
  EngineConfig,
  GameReview,
  ReviewGameInput
} from "@chaturanga/shared/types/engine";
import {
  resolveReviewRating,
  resolveReviewSideRatings,
  type ReviewRating
} from "@chaturanga/shared/chess/review-rating";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import { settingsRepository } from "../db/repositories";
import { errorMessage } from "../logger";
import { engineConfigForId, engineResourceOptions } from "../engine/engine-config";
import type { EngineManager } from "../engine/engine-manager";
import { getAssetManager } from "../engine/asset-manager";
import { ENGINE_MANIFEST } from "../engine/engine-manifest";
import {
  analysePositionsWithEngine,
  reviewGameWithEngine,
  type ReviewMaia,
  type ReviewProgressSink
} from "../engine/review";
import { getMaia3Evaluator } from "../maia";
import { getTelemetry } from "../telemetry";
import {
  engineFamily,
  maiaProperties,
  plyBucket,
  reviewFailureCode
} from "../telemetry/properties";

/** The installed Maia 3 model's version (the pinned one when the install didn't record it). */
function maia3ModelVersion(): string {
  const record = getAssetManager().getInstalled().maia3;
  return record.version ?? record.manifestVersion ?? ENGINE_MANIFEST.maia3.version;
}

/**
 * Maia 3 for a review, when it runs (`useMaia`, else the `reviewUseMaia` setting) and is installed:
 * each side is read at its game rating, else the Settings rating for the game's mode, or both at
 * the `reviewMaiaRating` override (see resolveReviewSideRatings).
 */
function reviewMaiaFor(input: ReviewGameInput, settings: AppSettings): ReviewMaia | null {
  if (!(input.useMaia ?? settings.reviewUseMaia)) return null;
  const evaluator = getMaia3Evaluator();
  if (!evaluator.isInstalled()) return null;
  const context = input.rating;
  return {
    evaluator,
    modelVersion: maia3ModelVersion(),
    ratings: resolveReviewSideRatings({
      gameRatings: context ? { white: context.whiteElo, black: context.blackElo } : null,
      timeControl: input.timeControl,
      speed: context?.speed ?? null,
      ratings: settings.playerRatings,
      override: settings.reviewMaiaRating
    })
  };
}

/**
 * The rating a review is made for (chess/review-rating.ts): the game's own for the reviewed side,
 * else the Settings one for its mode. Never asks Lichess. `maiaRating`: the rating Maia 3 read that
 * side at (null when the review has no Maia), recorded as the review's Maia model.
 */
export function reviewRatingFor(
  input: Pick<ReviewGameInput, "rating" | "timeControl">,
  settings: Pick<AppSettings, "playerRatings" | "reviewPlayerColor">,
  maiaRating: number | null
): ReviewRating {
  const context = input.rating;
  return resolveReviewRating({
    side: context?.side ?? settings.reviewPlayerColor,
    gameRatings: context ? { white: context.whiteElo, black: context.blackElo } : null,
    timeControl: input.timeControl,
    speed: context?.speed ?? null,
    ratings: settings.playerRatings,
    installedMaiaModels: maiaRating === null ? [] : [maiaRating]
  });
}

/** What a review operation is, for usage analytics: its size and the search it runs. */
function reviewShape(
  input: ReviewGameInput,
  config: EngineConfig,
  multipv: number,
  maia: ReviewMaia | null
) {
  return {
    ply_count: input.moves.length,
    ply_bucket: plyBucket(input.moves.length),
    engine_family: engineFamily(config),
    search_ms: input.moveTimeMs ?? undefined,
    multipv,
    ...maiaProperties(maia !== null)
  };
}

/** Review knobs come from settings; an explicit `multipv` in the input wins. */
function reviewMultipv(input: ReviewGameInput, settings: AppSettings): number {
  return input.multipv && input.multipv > 0 ? input.multipv : settings.reviewMultiPv;
}

/** A review's progress relayed through EngineManager events (to the renderer). */
function relayedProgress(
  engineManager: EngineManager,
  input: ReviewGameInput,
  onMoveDone: () => void
): ReviewProgressSink {
  const { reviewId } = input;
  const totalMoves = input.moves.length;
  return {
    onPhaseProgress: (progress) =>
      engineManager.emit("reviewProgress", {
        reviewId,
        totalMoves,
        playedUci: input.moves[progress.moveIndex]?.uci ?? "",
        ...progress
      }),
    onMoveCompleted: ({ moveIndex, move, opening }) => {
      onMoveDone();
      engineManager.emit("reviewMoveCompleted", { reviewId, moveIndex, totalMoves, move, opening });
    },
    shouldCancel: () => engineManager.isReviewCancelled(reviewId)
  };
}

/**
 * A finished review with what it was made for. The operation id travels with the saved review, so
 * opening it later is attributable; the rating it was made for, so it shows where that came from;
 * and the side it was made for.
 */
function withReviewFacts(
  review: GameReview,
  input: ReviewGameInput,
  settings: AppSettings
): GameReview {
  const side = input.rating?.side ?? settings.reviewPlayerColor;
  return {
    ...review,
    reviewId: input.reviewId,
    rating: reviewRatingFor(input, settings, review.maia?.[side].rating ?? null),
    side
  };
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
  const settings = settingsRepository.getAll();
  const multipv = reviewMultipv(input, settings);
  const { reviewId } = input;
  const maia = reviewMaiaFor(input, settings);

  const telemetry = getTelemetry();
  const startedAt = performance.now();
  const operation = {
    review_id: reviewId,
    game_ref: telemetry?.gameRef(input.gameId) ?? undefined,
    ...reviewShape(input, config, multipv, maia)
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
      relayedProgress(engineManager, input, () => (movesDone += 1)),
      { ...engineResourceOptions(settings), maia }
    );
    const finished = withReviewFacts(review, input, settings);
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
