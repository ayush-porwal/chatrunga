/**
 * How hard each move was to find at a rating, from the review's Maia predictions: a move's
 * difficulty is 1 − Maia's probability of the engine's best move in the position before it, at
 * the chosen Maia model (an obvious best move is easy; one Maia rarely plays is hard).
 */
import type { MoveReview } from "../types/engine";

type PredictedMove = Pick<MoveReview, "bestMove" | "humanPredictions">;

/**
 * Maia's probability, at `model`, that the mover plays the engine's best move; null when the move
 * has no best move or no prediction at that model, or the prediction doesn't price the best move.
 */
export function bestMoveChance(move: PredictedMove, model: number): number | null {
  const best = move.bestMove;
  if (!best) return null;
  const prediction = move.humanPredictions?.find((item) => item.rating === model);
  if (!prediction) return null;
  if (prediction.bestProb !== undefined) return prediction.bestProb;
  // Reviews that kept only Maia's top moves still price a best move among them.
  return prediction.topMoves.find((item) => item.uci === best)?.prob ?? null;
}

/** The move's difficulty at `model` in [0, 1] (1 − {@link bestMoveChance}); null without it. */
export function maiaDifficulty(move: PredictedMove, model: number): number | null {
  const chance = bestMoveChance(move, model);
  return chance === null ? null : Math.min(1, Math.max(0, 1 - chance));
}

/**
 * The Maia model to read a review's difficulty at: `preferred` (the model the review was made
 * for) when its moves carry predictions at it, otherwise the model nearest `rating` that they
 * carry (the lower one on a tie). Null when no move has a Maia prediction.
 */
export function difficultyModel(
  moves: readonly Pick<MoveReview, "humanPredictions">[],
  preferred: number | null,
  rating: number
): number | null {
  const models = new Set<number>();
  for (const move of moves)
    for (const prediction of move.humanPredictions ?? []) models.add(prediction.rating);
  if (preferred !== null && models.has(preferred)) return preferred;
  let nearest: number | null = null;
  for (const model of [...models].sort((a, b) => a - b))
    if (nearest === null || Math.abs(model - rating) < Math.abs(nearest - rating)) nearest = model;
  return nearest;
}
