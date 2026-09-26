import { create } from "zustand";
import type {
  GameReview,
  MoveReview,
  ReviewCommentary,
  ReviewProgress
} from "@chaturanga/shared/types/engine";

type ReviewStatus = "idle" | "running" | "ready" | "error" | "cancelled";

type ReviewStore = {
  status: ReviewStatus;
  review: GameReview | null;
  error: string | null;
  reviewId: string | null;
  progress: ReviewProgress | null;
  partialMoves: MoveReview[];
  startReview: (reviewId: string) => void;
  setReview: (review: GameReview) => void;
  setError: (error: string) => void;
  reset: () => void;
  /** Apply a throttled batch of engine events in one update (one render per batch). */
  applyReviewEvents: (batch: { progress: ReviewProgress | null; moves: readonly MoveReview[] }) => void;
  markCancelled: () => void;
  loadReview: (review: GameReview | null) => void;
  addCommentary: (commentary: ReviewCommentary) => void;
};

export const useReviewStore = create<ReviewStore>((set) => ({
  status: "idle",
  review: null,
  error: null,
  reviewId: null,
  progress: null,
  partialMoves: [],
  startReview: (reviewId) =>
    set((state) => ({
      status: "running",
      error: null,
      reviewId,
      progress: null,
      partialMoves: [],
      review: state.review
    })),
  setReview: (review) =>
    set({
      status: "ready",
      review: { ...review, commentary: [] },
      error: null,
      progress: null,
      partialMoves: []
    }),
  addCommentary: (commentary) =>
    set((state) => {
      if (!state.review) return state;
      const existing = new Map((state.review.commentary ?? []).map((item) => [item.ply, item]));
      existing.set(commentary.ply, commentary);
      return {
        review: {
          ...state.review,
          commentary: [...existing.values()].sort((a, b) => a.ply - b.ply)
        }
      };
    }),
  setError: (error) => set({ status: "error", error, progress: null }),
  reset: () =>
    set({
      status: "idle",
      review: null,
      error: null,
      reviewId: null,
      progress: null,
      partialMoves: []
    }),
  applyReviewEvents: ({ progress, moves }) =>
    set((state) => {
      const next: Partial<ReviewStore> = {};
      if (progress && !sameProgressStep(state.progress, progress)) next.progress = progress;
      if (moves.length) next.partialMoves = mergePartialMoves(state.partialMoves, moves);
      return Object.keys(next).length ? next : state;
    }),
  markCancelled: () =>
    set({
      status: "cancelled",
      progress: null
    }),
  loadReview: (review) =>
    set({
      status: review ? "ready" : "idle",
      review,
      error: null,
      reviewId: null,
      progress: null,
      partialMoves: []
    })
}));

/**
 * The UI shows only "move n of N"; depth updates and before/after phases of the same move carry
 * no visible change, so they must not produce a store update (and a re-render).
 */
function sameProgressStep(current: ReviewProgress | null, next: ReviewProgress): boolean {
  return Boolean(
    current &&
    current.reviewId === next.reviewId &&
    current.moveIndex === next.moveIndex &&
    current.totalMoves === next.totalMoves
  );
}

function mergePartialMoves(current: MoveReview[], incoming: readonly MoveReview[]): MoveReview[] {
  let next = current;
  for (const move of incoming) {
    const index = next.findIndex((existing) => existing.nodeId === move.nodeId);
    next = index >= 0 ? next.map((existing, i) => (i === index ? move : existing)) : [...next, move];
  }
  return next;
}

/**
 * The reviewed moves to display: the live results while a pass runs, otherwise the finished
 * review (or whatever a stopped pass produced). Returns store-owned arrays, so it is a stable
 * zustand selector.
 */
export function selectDisplayedMoves(state: Pick<ReviewStore, "status" | "review" | "partialMoves">): MoveReview[] {
  return state.status === "running" ? state.partialMoves : state.review?.moves ?? state.partialMoves;
}

export function reviewsByNode(moves: readonly MoveReview[]): Map<string, MoveReview> {
  return new Map(moves.map((move) => [move.nodeId, move]));
}
