import { create } from "zustand";
import { savedReviewInfo } from "@chaturanga/shared/chess/review-info";
import type { SavedReviewInfo } from "@chaturanga/shared/types/chess";
import {
  savedReviewCommentary,
  type GameReview,
  type MoveReview,
  type ReviewCommentary,
  type ReviewProgress
} from "@chaturanga/shared/types/engine";

type ReviewStatus = "idle" | "running" | "ready" | "error" | "cancelled";

type ReviewStore = {
  status: ReviewStatus;
  review: GameReview | null;
  /** Where `review` came from: produced by a run in this session, or loaded with a saved game. */
  origin: "run" | "saved" | null;
  error: string | null;
  reviewId: string | null;
  progress: ReviewProgress | null;
  partialMoves: MoveReview[];
  /**
   * Every saved analysis of the loaded game, newest first (re-analysing adds one; each keeps its
   * own AI commentary). `review` is the one shown.
   */
  analyses: SavedReviewInfo[];
  startReview: (reviewId: string) => void;
  setReview: (review: GameReview) => void;
  setError: (error: string) => void;
  reset: () => void;
  /**
   * Leave the running review (if any) without dropping the saved one: its late events are ignored
   * from now on, and the review shown stays the one the game had.
   */
  detachRun: () => void;
  /** Apply a throttled batch of engine events in one update (one render per batch). */
  applyReviewEvents: (batch: { progress: ReviewProgress | null; moves: readonly MoveReview[] }) => void;
  markCancelled: () => void;
  /** Shows `review`; `analyses` replaces the list (a newly opened game), else the list stays. */
  loadReview: (review: GameReview | null, analyses?: SavedReviewInfo[]) => void;
  addCommentary: (commentary: ReviewCommentary) => void;
};

export const useReviewStore = create<ReviewStore>((set) => ({
  status: "idle",
  review: null,
  origin: null,
  error: null,
  reviewId: null,
  progress: null,
  partialMoves: [],
  analyses: [],
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
    set((state) => {
      // A finished run is a new analysis of the game, listed first; the earlier ones stay.
      const id = review.reviewId ?? state.reviewId ?? `run-${review.createdAt}`;
      const shown: GameReview = { ...review, reviewId: id, commentary: [] };
      return {
        status: "ready",
        review: shown,
        origin: "run",
        error: null,
        progress: null,
        partialMoves: [],
        analyses: [savedReviewInfo(shown, id), ...state.analyses.filter((info) => info.reviewId !== id)]
      };
    }),
  addCommentary: (commentary) =>
    set((state) => {
      if (!state.review) return state;
      const existing = new Map((state.review.commentary ?? []).map((item) => [item.ply, item]));
      existing.set(commentary.ply, commentary);
      const review = { ...state.review, commentary: [...existing.values()].sort((a, b) => a.ply - b.ply) };
      return {
        review,
        // The comment belongs to the analysis shown: its count in the list follows.
        analyses: state.analyses.map((info) =>
          info.reviewId === review.reviewId ? { ...info, commentaryCount: review.commentary.length } : info
        )
      };
    }),
  setError: (error) => set({ status: "error", error, progress: null }),
  detachRun: () =>
    set((state) =>
      state.status === "running"
        ? { reviewId: null, status: state.review ? "ready" : "idle", progress: null, partialMoves: [] }
        : { reviewId: null }
    ),
  reset: () =>
    set({
      status: "idle",
      review: null,
      origin: null,
      error: null,
      reviewId: null,
      progress: null,
      partialMoves: [],
      analyses: []
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
  loadReview: (review, analyses) =>
    set((state) => ({
      analyses: analyses ?? state.analyses,
      status: review ? "ready" : "idle",
      // Saved reviews may hold explanations from the retired offline template; drop them so
      // the AI is asked when those moves are viewed.
      review: review?.commentary ? { ...review, commentary: savedReviewCommentary(review.commentary) } : review,
      origin: review ? "saved" : null,
      error: null,
      reviewId: null,
      progress: null,
      partialMoves: []
    }))
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
