import { useEffect } from "react";
import type { MoveReview, ReviewProgress } from "@chaturanga/shared/types/engine";
import { useGameStore } from "../stores/game-store";
import { useReviewStore } from "../stores/review-store";
import { lineStillOnMainline } from "../stores/review-validity";
import { cancelActiveReview } from "./useReviewRunner";

/** Events belong to the review the store is tracking; late events of an older review are dropped. */
export function acceptsReviewEvent(reviewId: string | null, eventReviewId: string): boolean {
  return Boolean(reviewId && reviewId === eventReviewId);
}

/** Engine progress/move events are coalesced so the review UI updates at most this often. */
export const REVIEW_EVENT_FLUSH_MS = 250;

type ReviewEventBatch = { reviewId: string; progress: ReviewProgress | null; moves: MoveReview[] };

/**
 * Throttles the per-depth progress stream (several events per second per move) and the
 * per-move completions into one trailing flush every `intervalMs`.
 */
export function createReviewEventBuffer(
  flush: (batch: ReviewEventBatch) => void,
  intervalMs = REVIEW_EVENT_FLUSH_MS
) {
  let batch: ReviewEventBatch | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const flushNow = () => {
    clearTimer();
    const pending = batch;
    batch = null;
    if (pending && (pending.progress || pending.moves.length)) flush(pending);
  };
  const target = (reviewId: string): ReviewEventBatch => {
    if (batch && batch.reviewId !== reviewId) flushNow();
    batch ??= { reviewId, progress: null, moves: [] };
    if (timer === null) timer = setTimeout(flushNow, intervalMs);
    return batch;
  };
  return {
    progress(progress: ReviewProgress) {
      target(progress.reviewId).progress = progress;
    },
    move(reviewId: string, move: MoveReview) {
      target(reviewId).moves.push(move);
    },
    flushNow,
    discard() {
      clearTimer();
      batch = null;
    }
  };
}

/**
 * Wires the review store to the main process's review event stream. Mount once, above the
 * routes, so events keep flowing while the user navigates between views.
 */
export function useReviewEventSubscription(): void {
  useEffect(() => {
    if (!window.chaturanga?.events) return;

    const buffer = createReviewEventBuffer((batch) => {
      const store = useReviewStore.getState();
      if (!acceptsReviewEvent(store.reviewId, batch.reviewId) || store.status !== "running") return;
      store.applyReviewEvents(batch);
    });
    const unsubProgress = window.chaturanga.events.onReviewProgress((progress) => {
      if (!acceptsReviewEvent(useReviewStore.getState().reviewId, progress.reviewId)) return;
      buffer.progress(progress);
    });
    const unsubMoveCompleted = window.chaturanga.events.onReviewMoveCompleted((event) => {
      if (!acceptsReviewEvent(useReviewStore.getState().reviewId, event.reviewId)) return;
      buffer.move(event.reviewId, event.move);
    });
    const unsubCompleted = window.chaturanga.events.onReviewCompleted((event) => {
      const store = useReviewStore.getState();
      if (!acceptsReviewEvent(store.reviewId, event.reviewId)) return;
      buffer.discard();
      // A result for a line the game no longer has is not an analysis of this game.
      if (store.runLine && !lineStillOnMainline(store.runLine, useGameStore.getState().moveTree)) {
        store.detachRun();
        return;
      }
      store.setReview(event.review);
    });
    const unsubFailed = window.chaturanga.events.onReviewFailed((event) => {
      const store = useReviewStore.getState();
      if (!acceptsReviewEvent(store.reviewId, event.reviewId)) return;
      // Keep the moves reviewed so far visible after a stop.
      buffer.flushNow();
      if (event.message === "Review cancelled") store.markCancelled();
      else store.setError(event.message);
    });
    // An edit that takes analysed moves off the main line (deleting, replacing or demoting them)
    // stops the run: its results would describe moves the game no longer has. Extending the line,
    // moving the cursor or editing a variation leaves it running.
    const unsubGame = useGameStore.subscribe((state, previous) => {
      if (state.moveTree === previous.moveTree) return;
      const store = useReviewStore.getState();
      if (store.status !== "running" || !store.runLine) return;
      if (lineStillOnMainline(store.runLine, state.moveTree)) return;
      buffer.discard();
      void cancelActiveReview();
      store.detachRun();
    });

    return () => {
      buffer.discard();
      unsubGame();
      unsubProgress();
      unsubMoveCompleted();
      unsubCompleted();
      unsubFailed();
    };
  }, []);
}
