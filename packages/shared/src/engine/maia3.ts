/**
 * Maia 3 (CSSLab's ONNX model, run unmodified in a hidden host window): its ratings, main's
 * evaluator contract and the prediction a review stores (the host window's messages are in
 * maia3-host.ts).
 *
 * One model covers every rating through two continuous inputs: `eloSelf` (the side to move) and
 * `eloOppo` (its opponent). For each board CSSLab's `batchEvaluateMaia3` returns a policy (each
 * legal move's probability, softmax over the legal moves' logits, sorted descending) and a value
 * (White's winning chances, W + D/2, rounded to 4 decimals).
 *
 * The app uses ratings 600–2600 in steps of 100 ({@link MAIA3_RATINGS}): a review reads Maia at the
 * mover's rating snapped to that grid, its rating curve at every grid point.
 */
import { standardCastlingUci } from "../chess/review";
import type { MaiaMoveProb, RatingPrediction } from "../types/engine";

export const MAIA3_RATING_RANGE = { min: 600, max: 2600, step: 100 } as const;

/** Every rating the app asks Maia 3 at: 600 to 2600 in steps of 100 (21 points). */
export const MAIA3_RATINGS: readonly number[] = Array.from(
  { length: (MAIA3_RATING_RANGE.max - MAIA3_RATING_RANGE.min) / MAIA3_RATING_RANGE.step + 1 },
  (_, index) => MAIA3_RATING_RANGE.min + index * MAIA3_RATING_RANGE.step
);

export const MAIA3_DEFAULT_RATING = 1500;

/** Moves a saved review keeps per rating (the played and best moves' odds are kept besides). */
const SAVED_TOP_MOVES = 5;

/** `rating` rounded to a whole number within 600–2600 (the default for a non-number). */
export function clampMaia3Rating(rating: number): number {
  if (!Number.isFinite(rating)) return MAIA3_DEFAULT_RATING;
  const { min, max } = MAIA3_RATING_RANGE;
  return Math.max(min, Math.min(max, Math.round(rating)));
}

/** The grid rating nearest `rating` (half-way rounds up), within 600–2600. */
export function nearestMaia3Rating(rating: number): number {
  const { step } = MAIA3_RATING_RANGE;
  return clampMaia3Rating(Math.round(clampMaia3Rating(rating) / step) * step);
}

/** One position for Maia 3: `eloSelf` is the side to move's rating, `eloOppo` its opponent's. */
export type Maia3Query = { fen: string; eloSelf: number; eloOppo: number };

/**
 * Maia 3's answer for one position: each legal move's probability (sorted descending) and White's
 * winning chances (W + D/2) in [0, 1], whichever side is to move.
 */
export type Maia3Output = { policy: Record<string, number>; value: number };

/** Runs Maia 3 (main's host-window client). */
export interface Maia3Evaluator {
  /**
   * One output per query, in order. A game's moves (`priority: "game"`) go ahead of a review's.
   * Rejects with {@link Maia3UnavailableError} when the model isn't installed or can't run.
   */
  evaluate(
    queries: readonly Maia3Query[],
    options?: { priority?: "game" | "review"; signal?: AbortSignal }
  ): Promise<Maia3Output[]>;
  isInstalled(): boolean;
  dispose(): void;
}

/** Maia 3 can't evaluate: the model isn't downloaded, or its host failed. */
export class Maia3UnavailableError extends Error {
  override name = "Maia3UnavailableError";
}

/** Policy entries sorted by probability, highest first (ties keep their order). */
export function rankedMoves(policy: Readonly<Record<string, number>>): MaiaMoveProb[] {
  return Object.entries(policy)
    .map(([uci, prob]) => ({ uci, prob }))
    .sort((a, b) => b.prob - a.prob);
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

type Maia3PredictionInput = {
  output: Maia3Output;
  /** The position Maia read (castling is compared in standard UCI, `e1g1`). */
  fen: string;
  /** The rating it was asked at (eloSelf). */
  rating: number;
  playedUci: string;
  /** The main engine's best move. */
  bestUci: string | null;
  /** How many of Maia's likeliest moves to keep (default 5). */
  topMoves?: number;
};

/**
 * The prediction a review stores for one position at one rating: Maia's likeliest moves, the
 * played and best moves' probabilities and 1-based ranks in the full policy (a played move missing
 * from it has probability 0 and no rank), and White's winning chances. Probabilities are rounded to
 * 4 decimals, as Maia 1's were.
 */
export function maia3Prediction(input: Maia3PredictionInput): RatingPrediction {
  const moves = rankedMoves(input.output.policy).map((move) => ({
    uci: standardCastlingUci(input.fen, move.uci),
    prob: move.prob
  }));
  const indexOf = (uci: string) => {
    const standard = standardCastlingUci(input.fen, uci);
    return moves.findIndex((move) => move.uci === standard);
  };
  const played = indexOf(input.playedUci);
  const best = input.bestUci ? indexOf(input.bestUci) : -1;
  const prediction: RatingPrediction = {
    rating: input.rating,
    topMoves: moves
      .slice(0, input.topMoves ?? SAVED_TOP_MOVES)
      .map((move) => ({ uci: move.uci, prob: round4(move.prob) })),
    playedProb: played >= 0 ? round4(moves[played].prob) : 0,
    whiteWinProb: input.output.value
  };
  if (played >= 0) prediction.playedRank = played + 1;
  if (best >= 0) {
    prediction.bestProb = round4(moves[best].prob);
    prediction.bestRank = best + 1;
  }
  return prediction;
}
