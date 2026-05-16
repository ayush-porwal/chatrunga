import { beforeEach, describe, expect, it } from "vitest";
import { partialReviewByNode, reviewByNode, useReviewStore } from "./review-store";
import type { GameReview, MoveReview } from "@chaturanga/shared/types/engine";

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

  it("selects the first missed tactic when review completes", () => {
    const done = review([move("a", "good"), move("b", "missed_tactic")]);

    useReviewStore.getState().startReview("r1");
    useReviewStore.getState().setReview(done);

    expect(useReviewStore.getState()).toMatchObject({
      status: "ready",
      selectedNodeId: "b",
      reviewId: "r1",
      progress: null,
      partialMoves: []
    });
  });

  it("replaces partial moves for the same node", () => {
    useReviewStore.getState().appendPartialMove(move("a", "good"));
    useReviewStore.getState().appendPartialMove(move("a", "blunder"));

    expect(useReviewStore.getState().partialMoves).toHaveLength(1);
    expect(useReviewStore.getState().partialMoves[0]?.classification).toBe("blunder");
  });

  it("indexes full and partial reviews by node", () => {
    const first = move("a", "best");
    const second = move("b", "mistake");

    expect(reviewByNode(review([first, second])).get("b")).toBe(second);
    expect(partialReviewByNode([first]).get("a")).toBe(first);
  });

  it("handles cancellation, errors, and loaded reviews", () => {
    const loaded = review([move("loaded", "excellent")]);

    useReviewStore.getState().setError("failed");
    expect(useReviewStore.getState()).toMatchObject({ status: "error", error: "failed" });

    useReviewStore.getState().markCancelled();
    expect(useReviewStore.getState().status).toBe("cancelled");

    useReviewStore.getState().loadReview(loaded);
    expect(useReviewStore.getState()).toMatchObject({ status: "ready", selectedNodeId: "loaded" });
  });
});
