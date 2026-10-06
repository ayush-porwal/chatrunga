import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MoveReview, ReviewProgress } from "@chaturanga/shared/types/engine";
import {
  acceptsReviewEvent,
  createReviewEventBuffer,
  REVIEW_EVENT_FLUSH_MS
} from "./useReviewEventSubscription";

const progress = (reviewId: string, moveIndex: number, depth: number) =>
  ({ reviewId, moveIndex, depth, totalMoves: 10 }) as unknown as ReviewProgress;
const move = (nodeId: string) => ({ nodeId }) as unknown as MoveReview;

describe("review event routing", () => {
  it("accepts events only for the active review id", () => {
    expect(acceptsReviewEvent("review-1", "review-1")).toBe(true);
    expect(acceptsReviewEvent("review-1", "review-2")).toBe(false);
  });

  it("does not accept late events after the active review is cleared", () => {
    expect(acceptsReviewEvent(null, "review-1")).toBe(false);
  });
});

describe("review event buffer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces a burst of engine events into one trailing flush", () => {
    const flush = vi.fn<Parameters<typeof createReviewEventBuffer>[0]>();
    const buffer = createReviewEventBuffer(flush);
    for (let depth = 1; depth <= 20; depth += 1) buffer.progress(progress("r1", 0, depth));
    const opening = { eco: "C50", name: "Italian Game", ply: 5, bookEndPly: 6 };
    buffer.move("r1", move("a"), { ...opening, firstNonBookMove: null });
    buffer.progress(progress("r1", 1, 1));
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REVIEW_EVENT_FLUSH_MS);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0][0]).toMatchObject({
      reviewId: "r1",
      progress: { moveIndex: 1 },
      moves: [{ nodeId: "a" }],
      opening
    });
    // Progress alone says nothing of the opening.
    buffer.progress(progress("r1", 2, 1));
    vi.advanceTimersByTime(REVIEW_EVENT_FLUSH_MS);
    expect(flush.mock.calls[1][0].opening).toBeUndefined();
  });

  it("flushes pending moves on demand and drops them on discard", () => {
    const flush = vi.fn<Parameters<typeof createReviewEventBuffer>[0]>();
    const buffer = createReviewEventBuffer(flush);
    buffer.move("r1", move("a"));
    buffer.flushNow();
    expect(flush).toHaveBeenCalledTimes(1);
    buffer.move("r1", move("b"));
    buffer.discard();
    vi.advanceTimersByTime(REVIEW_EVENT_FLUSH_MS * 2);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("never mixes events from two reviews in one batch", () => {
    const flush = vi.fn<Parameters<typeof createReviewEventBuffer>[0]>();
    const buffer = createReviewEventBuffer(flush);
    buffer.move("r1", move("a"));
    buffer.move("r2", move("b"));
    vi.advanceTimersByTime(REVIEW_EVENT_FLUSH_MS);
    expect(flush.mock.calls.map((call) => call[0].reviewId)).toEqual(["r1", "r2"]);
  });
});
