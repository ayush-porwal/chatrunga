import { create } from "zustand";
import type {
  GameReview,
  MoveReview,
  ReviewProgress
} from "@chaturanga/shared/types/engine";

type ReviewStatus = "idle" | "running" | "ready" | "error" | "cancelled";

type ReviewStore = {
  status: ReviewStatus;
  review: GameReview | null;
  selectedNodeId: string | null;
  error: string | null;
  reviewId: string | null;
  progress: ReviewProgress | null;
  partialMoves: MoveReview[];
  startReview: (reviewId: string) => void;
  setReview: (review: GameReview) => void;
  setSelectedNode: (nodeId: string | null) => void;
  setError: (error: string) => void;
  reset: () => void;
  setProgress: (progress: ReviewProgress) => void;
  appendPartialMove: (move: MoveReview) => void;
  markCancelled: () => void;
  loadReview: (review: GameReview | null) => void;
};

export const useReviewStore = create<ReviewStore>((set) => ({
  status: "idle",
  review: null,
  selectedNodeId: null,
  error: null,
  reviewId: null,
  progress: null,
  partialMoves: [],
  startReview: (reviewId) =>
    set({
      status: "running",
      error: null,
      reviewId,
      progress: null,
      partialMoves: [],
      review: null
    }),
  setReview: (review) =>
    set({
      status: "ready",
      review,
      selectedNodeId:
        review.moves.find((move) => move.classification === "missed_tactic")?.nodeId ??
        review.moves[0]?.nodeId ??
        null,
      error: null,
      progress: null,
      partialMoves: []
    }),
  setSelectedNode: (selectedNodeId) => set({ selectedNodeId }),
  setError: (error) => set({ status: "error", error, progress: null }),
  reset: () =>
    set({
      status: "idle",
      review: null,
      selectedNodeId: null,
      error: null,
      reviewId: null,
      progress: null,
      partialMoves: []
    }),
  setProgress: (progress) => set({ progress }),
  appendPartialMove: (move) =>
    set((state) => ({
      partialMoves: state.partialMoves.some((existing) => existing.nodeId === move.nodeId)
        ? state.partialMoves.map((existing) =>
          existing.nodeId === move.nodeId ? move : existing
        )
        : [...state.partialMoves, move]
    })),
  markCancelled: () =>
    set({
      status: "cancelled",
      progress: null
    }),
  loadReview: (review) =>
    set({
      status: review ? "ready" : "idle",
      review,
      selectedNodeId: review ? review.moves[0]?.nodeId ?? null : null,
      error: null,
      reviewId: null,
      progress: null,
      partialMoves: []
    })
}));

export function reviewByNode(review: GameReview | null): Map<string, MoveReview> {
  const map = new Map<string, MoveReview>();
  for (const move of review?.moves ?? []) map.set(move.nodeId, move);
  return map;
}

export function partialReviewByNode(moves: MoveReview[]): Map<string, MoveReview> {
  const map = new Map<string, MoveReview>();
  for (const move of moves) map.set(move.nodeId, move);
  return map;
}
