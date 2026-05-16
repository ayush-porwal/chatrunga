import type { ReviewGameInput } from "@chaturanga/shared/types/engine";

/** Used when neither depth nor movetime is set — time-bounded search works for Stockfish, lc0, Maia, etc. */
export const DEFAULT_REVIEW_MOVETIME_MS = 5_000;

/** Legacy default when callers request depth-only mode. */
export const DEFAULT_REVIEW_DEPTH = 14;

export type ResolvedReviewSearch = {
  /** For `go movetime` when non-null; otherwise `go depth` uses `depth`. */
  moveTimeMs: number | null;
  /** Passed to `go depth` when `moveTimeMs` is null. */
  depth: number;
  /** Stored on `GameReview` — reflects what actually bounded the search. */
  recordMoveTimeMs: number | null;
  recordDepth: number | null;
};

/**
 * Resolves how to drive `go …` for any UCI engine:
 * - explicit positive `moveTimeMs` → movetime (works well for NN engines)
 * - else explicit positive `depth` → depth (typical for classical engines)
 * - else default movetime (universal fallback)
 */
export function resolveReviewSearchParams(
  input: Pick<ReviewGameInput, "depth" | "moveTimeMs">
): ResolvedReviewSearch {
  const mt = input.moveTimeMs;
  const d = input.depth;
  const hasMoveTime = typeof mt === "number" && Number.isFinite(mt) && mt > 0;
  const hasDepth = typeof d === "number" && Number.isFinite(d) && d > 0;

  if (hasMoveTime) {
    return {
      moveTimeMs: mt,
      depth: hasDepth ? d : DEFAULT_REVIEW_DEPTH,
      recordMoveTimeMs: mt,
      recordDepth: null
    };
  }
  if (hasDepth) {
    return {
      moveTimeMs: null,
      depth: d,
      recordMoveTimeMs: null,
      recordDepth: d
    };
  }
  return {
    moveTimeMs: DEFAULT_REVIEW_MOVETIME_MS,
    depth: DEFAULT_REVIEW_DEPTH,
    recordMoveTimeMs: DEFAULT_REVIEW_MOVETIME_MS,
    recordDepth: null
  };
}

/** Wall-clock budget: NN + MultiPV needs far more than 15s for depth-based search. */
export function reviewAnalysisTimeoutMs(params: {
  moveTimeMs: number | null;
  depth: number;
  multipv: number;
}): number {
  const mp = Math.max(1, Math.min(params.multipv, 5));
  if (params.moveTimeMs !== null && params.moveTimeMs > 0) {
    return Math.max(90_000, params.moveTimeMs * (5 + mp * 2) + 35_000);
  }
  const d = Math.max(1, params.depth);
  return Math.max(180_000, d * 30_000 * mp, d * 20_000 + mp * 90_000);
}
