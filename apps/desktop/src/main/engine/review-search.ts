import type { ReviewGameInput } from "@chaturanga/shared/types/engine";

/** Used when no search bound is set — time-bounded search works for Stockfish, lc0, Maia, etc. */
export const DEFAULT_REVIEW_MOVETIME_MS = 250;

/** Legacy default when callers request depth-only mode. */
export const DEFAULT_REVIEW_DEPTH = 14;

/**
 * Precedence: nodes > moveTimeMs > depth > default movetime.
 *
 * This drives the evaluation engine. Maia sessions always run `go nodes 1`
 * with VerboseMoveStats (see `UciReviewSession.analyzePolicy`).
 */
export type ResolvedReviewSearch = {
  /** When non-null, sent as `go nodes N`. Wins over moveTimeMs and depth. */
  nodes: number | null;
  /** For `go movetime` when non-null and `nodes` is null. */
  moveTimeMs: number | null;
  /** Passed to `go depth` when `nodes` and `moveTimeMs` are both null. */
  depth: number;
  /** Stored on `GameReview` — reflects what actually bounded the search. */
  recordMoveTimeMs: number | null;
  recordDepth: number | null;
};

/**
 * Resolves how to drive `go …` for any UCI engine.
 * Precedence: nodes > moveTimeMs > depth > default movetime.
 */
export function resolveReviewSearchParams(
  input: Pick<ReviewGameInput, "depth" | "moveTimeMs" | "nodes">
): ResolvedReviewSearch {
  const n = input.nodes;
  const mt = input.moveTimeMs;
  const d = input.depth;
  const hasNodes = typeof n === "number" && Number.isFinite(n) && n > 0;
  const hasMoveTime = typeof mt === "number" && Number.isFinite(mt) && mt > 0;
  const hasDepth = typeof d === "number" && Number.isFinite(d) && d > 0;

  if (hasNodes) {
    return {
      nodes: n,
      moveTimeMs: null,
      depth: hasDepth ? d : DEFAULT_REVIEW_DEPTH,
      recordMoveTimeMs: null,
      recordDepth: null
    };
  }
  if (hasMoveTime) {
    return {
      nodes: null,
      moveTimeMs: mt,
      depth: hasDepth ? d : DEFAULT_REVIEW_DEPTH,
      recordMoveTimeMs: mt,
      recordDepth: null
    };
  }
  if (hasDepth) {
    return {
      nodes: null,
      moveTimeMs: null,
      depth: d,
      recordMoveTimeMs: null,
      recordDepth: d
    };
  }
  return {
    nodes: null,
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
  nodes?: number | null;
}): number {
  const mp = Math.max(1, Math.min(params.multipv, 5));
  // `nodes` mode (typically nodes=1 for Maia policy) returns near-instantly per move;
  // even multi-Maia parallelism finishes well under a second per position.
  if (typeof params.nodes === "number" && params.nodes > 0) {
    return Math.max(10_000, params.nodes * 1_000 * mp + 5_000);
  }
  if (params.moveTimeMs !== null && params.moveTimeMs > 0) {
    return Math.max(90_000, params.moveTimeMs * (5 + mp * 2) + 35_000);
  }
  const d = Math.max(1, params.depth);
  return Math.max(180_000, d * 30_000 * mp, d * 20_000 + mp * 90_000);
}
