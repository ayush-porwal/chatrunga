/**
 * `engines.maiaCurve`: a reviewed move's rating curve, read from Maia 3 on demand. Loaded with the
 * first curve asked for (register.ts), so the main bundle doesn't carry it until then.
 */
import {
  MAIA_CURVE_NOT_SAVED,
  type MaiaCurveInput,
  type RatingPrediction
} from "@chaturanga/shared/types/engine";
import {
  MAIA3_RATINGS,
  Maia3UnavailableError,
  maia3Prediction,
  type Maia3Output
} from "@chaturanga/shared/engine/maia3";
import { gameRepository } from "../db/repositories";
import { logger } from "../logger";
import { getMaia3Evaluator } from "../maia";
import { asId, asObject } from "./fields";

/** `engines.maiaCurve`'s input, checked (it comes from the renderer). */
export function parseMaiaCurveInput(value: unknown): MaiaCurveInput {
  const input = asObject(value, "Maia curve");
  return {
    gameId: asId(input.gameId, "game id"),
    reviewId: asId(input.reviewId, "review id"),
    nodeId: asId(input.nodeId, "node id")
  };
}

/** Maia 3's rating curve: a prediction at every rating it is asked at, ascending (MAIA3_RATINGS). */
function isMaia3Curve(predictions: readonly RatingPrediction[]): boolean {
  return (
    predictions.length === MAIA3_RATINGS.length &&
    predictions.every(
      (prediction, index) =>
        prediction.rating === MAIA3_RATINGS[index] && typeof prediction.whiteWinProb === "number"
    )
  );
}

/** Curves being computed, by game, analysis and move: a second request for one shares the first. */
const curvesInFlight = new Map<string, Promise<RatingPrediction[]>>();

/** A curve request waiting for its analysis's turn at Maia. */
type WaitingCurve = { start: () => void; supersede: () => void };

/**
 * One analysis's curves go to Maia one at a time, and of those waiting only the newest is kept:
 * each takes 2–6 s, so stepping through moves would otherwise queue a curve per move, and the move
 * on screen would wait behind all of them. The one Maia is reading goes on (it is saved, so its
 * move is instant when shown again). Keyed by analysis: present while one of its curves is at
 * Maia, with the curve waiting behind it, if any.
 */
const curveLanes = new Map<string, WaitingCurve | null>();

/**
 * Resolves when it is this request's turn at Maia, with the call that hands the turn on (call it
 * once Maia has answered); rejects when a newer request for the analysis replaces it first.
 */
function turnAtMaia(laneKey: string): Promise<() => void> {
  const done = () => {
    const next = curveLanes.get(laneKey);
    if (!next) {
      curveLanes.delete(laneKey);
      return;
    }
    curveLanes.set(laneKey, null);
    next.start();
  };
  if (!curveLanes.has(laneKey)) {
    curveLanes.set(laneKey, null);
    return Promise.resolve(done);
  }
  return new Promise((resolve, reject) => {
    curveLanes.get(laneKey)?.supersede();
    curveLanes.set(laneKey, {
      start: () => resolve(done),
      supersede: () => reject(new Error("A newer rating curve was asked for."))
    });
  });
}

/**
 * How players of every rating (600–2600) would move in a reviewed move's position, for a saved
 * Maia 3 analysis: read from the analysis when it already holds the curve, else asked of Maia 3
 * (eloSelf = eloOppo = each rating, all in one request) and saved into the move's
 * `humanPredictions`, so it is instant next time. A running review's analysis isn't saved yet, so
 * the curve waits until it is (the renderer shows it for finished analyses).
 */
export function maiaCurve(input: MaiaCurveInput): Promise<RatingPrediction[]> {
  const key = JSON.stringify([input.gameId, input.reviewId, input.nodeId]);
  const running = curvesInFlight.get(key);
  if (running) return running;
  const curve = computeMaiaCurve(input).finally(() => curvesInFlight.delete(key));
  curvesInFlight.set(key, curve);
  return curve;
}

async function computeMaiaCurve({
  gameId,
  reviewId,
  nodeId
}: MaiaCurveInput): Promise<RatingPrediction[]> {
  const review = gameRepository.getReview(gameId, reviewId);
  if (!review) throw new Error(MAIA_CURVE_NOT_SAVED);
  if (review.maia?.model !== "maia3")
    throw new Error(
      "This analysis wasn't made with Maia 3: analyse the game again to see the curve."
    );
  const index = review.moves.findIndex((item) => item.nodeId === nodeId);
  if (index < 0) throw new Error("This analysis has no such move.");
  const move = review.moves[index];
  const stored = move.humanPredictions;
  if (stored && isMaia3Curve(stored)) return stored;

  const evaluator = getMaia3Evaluator();
  if (!evaluator.isInstalled())
    throw new Maia3UnavailableError("Maia 3 isn't installed: download it to see the rating curve.");
  const done = await turnAtMaia(JSON.stringify([gameId, reviewId]));
  let outputs: Maia3Output[];
  try {
    outputs = await evaluator.evaluate(
      MAIA3_RATINGS.map((rating) => ({ fen: move.fenBefore, eloSelf: rating, eloOppo: rating })),
      { priority: "review" }
    );
  } finally {
    done();
  }
  if (outputs.length !== MAIA3_RATINGS.length) throw new Error("Maia 3 gave an incomplete answer.");
  const curve = MAIA3_RATINGS.map((rating, at) =>
    maia3Prediction({
      output: outputs[at],
      fen: move.fenBefore,
      rating,
      playedUci: move.playedMove,
      bestUci: move.bestMove
    })
  );
  const saved = gameRepository.saveMaiaCurve(gameId, reviewId, {
    index,
    ply: move.ply,
    fenAfter: move.fenAfter,
    curve
  });
  if (!saved) logger.warn("review", "The rating curve's analysis changed; it was not saved.");
  return curve;
}
