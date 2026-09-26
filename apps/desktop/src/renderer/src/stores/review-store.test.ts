import { beforeEach, describe, expect, it } from "vitest";
import { reviewsByNode, selectDisplayedMoves, useReviewStore } from "./review-store";
import type { GameReview, MoveReview, ReviewProgress } from "@chaturanga/shared/types/engine";

function progress(moveIndex: number, overrides: Partial<ReviewProgress> = {}): ReviewProgress {
  return {
    reviewId: "r1",
    moveIndex,
    totalMoves: 10,
    nodeId: `n${moveIndex}`,
    ply: moveIndex + 1,
    san: "e4",
    playedUci: "e2e4",
    fenBefore: "before",
    fenAfter: "after",
    phase: "before",
    fen: "before",
    mover: "white",
    depth: 1,
    lines: [],
    ...overrides
  };
}

function move(nodeId: string, classification: MoveReview["classification"]): MoveReview {
  return {
    nodeId,
    ply: 1,
    san: "e4",
    playedMove: "e2e4",
    fenBefore: "before",
    fenAfter: "after",
    evalBefore: null,
    evalAfter: null,
    evalLoss: null,
    classification,
    bestMove: null,
    bestLine: [],
    topLines: [],
    motifs: []
  };
}

function review(moves: MoveReview[]): GameReview {
  return {
    engineId: "engine-1",
    depth: 12,
    moveTimeMs: null,
    createdAt: 1,
    summary: {
      totalMoves: moves.length,
      best: 0,
      excellent: 0,
      good: 0,
      inaccuracies: 0,
      mistakes: 0,
      blunders: 0,
      missedTactics: 0,
      averageCentipawnLoss: null
    },
    moves
  };
}

describe("review store", () => {
  beforeEach(() => {
    useReviewStore.getState().reset();
  });

  it("ignores depth/phase churn within the same move (no store update)", () => {
    useReviewStore.getState().startReview("r1");
    useReviewStore.getState().applyReviewEvents({ progress: progress(0), moves: [] });
    let updates = 0;
    const unsubscribe = useReviewStore.subscribe(() => { updates += 1; });
    useReviewStore.getState().applyReviewEvents({ progress: progress(0, { depth: 12, phase: "after" }), moves: [] });
    useReviewStore.getState().applyReviewEvents({ progress: progress(0, { depth: 18 }), moves: [] });
    expect(updates).toBe(0);
    useReviewStore.getState().applyReviewEvents({ progress: progress(1), moves: [move("a", "good"), move("b", "best")] });
    unsubscribe();
    expect(updates).toBe(1);
    expect(useReviewStore.getState().progress?.moveIndex).toBe(1);
    expect(useReviewStore.getState().partialMoves.map((item) => item.nodeId)).toEqual(["a", "b"]);
  });

  it("stores a completed review and clears partial progress", () => {
    const done = review([move("a", "good"), move("b", "missed_tactic")]);

    useReviewStore.getState().startReview("r1");
    useReviewStore.getState().setReview(done);

    expect(useReviewStore.getState()).toMatchObject({
      status: "ready",
      reviewId: "r1",
      progress: null,
      partialMoves: []
    });
    expect(useReviewStore.getState().review?.moves).toHaveLength(2);
  });

  it("replaces partial moves for the same node", () => {
    useReviewStore.getState().startReview("r1");
    useReviewStore.getState().applyReviewEvents({ progress: null, moves: [move("a", "good")] });
    useReviewStore.getState().applyReviewEvents({ progress: null, moves: [move("a", "blunder")] });

    expect(useReviewStore.getState().partialMoves).toHaveLength(1);
    expect(useReviewStore.getState().partialMoves[0]?.classification).toBe("blunder");
  });

  it("indexes reviewed moves by node", () => {
    const first = move("a", "best");
    const second = move("b", "mistake");

    expect(reviewsByNode([first, second]).get("b")).toBe(second);
  });

  it("displays live moves while running and the finished review otherwise", () => {
    const partial = [move("a", "good")];
    const done = review([move("a", "best"), move("b", "good")]);

    expect(selectDisplayedMoves({ status: "running", review: done, partialMoves: partial })).toBe(partial);
    expect(selectDisplayedMoves({ status: "ready", review: done, partialMoves: [] })).toBe(done.moves);
    expect(selectDisplayedMoves({ status: "cancelled", review: null, partialMoves: partial })).toBe(partial);
  });

  it("handles cancellation, errors, and loaded reviews", () => {
    const loaded = review([move("loaded", "excellent")]);

    useReviewStore.getState().setError("failed");
    expect(useReviewStore.getState()).toMatchObject({ status: "error", error: "failed" });

    useReviewStore.getState().markCancelled();
    expect(useReviewStore.getState().status).toBe("cancelled");

    useReviewStore.getState().loadReview(loaded);
    expect(useReviewStore.getState()).toMatchObject({ status: "ready", review: loaded });
  });
});
