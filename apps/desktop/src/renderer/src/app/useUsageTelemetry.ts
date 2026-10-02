import { useEffect } from "react";
import { REVIEW_STUDIED_MOVES } from "@chaturanga/shared/types/telemetry";
import type { GameMode } from "@chaturanga/shared/types/chess";
import {
  analyticsGameId,
  analyticsReviewId,
  hadRecentUserInput,
  isForeground,
  listenForUserInput,
  reportActivity,
  StudyCounter,
  trackUsage
} from "@/lib/usage-telemetry";
import { useGameStore } from "../stores/game-store";
import { useReviewStore } from "../stores/review-store";

function activityKind(mode: GameMode) {
  if (mode === "engine" || mode === "online") return "play" as const;
  if (mode === "puzzle") return "puzzle" as const;
  return "study" as const;
}

/**
 * Daily activity for usage analytics: a move made or stepped through right after the user's own
 * input, with the window in front. Restoring the last game at launch, engine replies arriving in
 * the background or a hidden window don't count.
 */
export function useUsageActivity(): void {
  useEffect(() => {
    listenForUserInput();
    return useGameStore.subscribe((state, previous) => {
      if (state.currentNodeId !== previous.currentNodeId) reportActivity(activityKind(state.mode));
    });
  }, []);
}

type StudyTarget = { reviewId: string | null; gameId: string | null };
const studyTargets = new Map<string, StudyTarget>();
const studyCounter = new StudyCounter(REVIEW_STUDIED_MOVES, (key) => {
  const target = studyTargets.get(key);
  if (target) trackUsage({ type: "review_studied", ...target });
});
/**
 * Game review page analytics: `review_opened` when a saved review is shown (a review this session
 * just produced is a completion, already counted by main), and `review_studied` once the user has
 * selected {@link REVIEW_STUDIED_MOVES} distinct reviewed moves of it. Main keeps each to once per
 * session, so showing the same review again is reported again.
 */
export function useReviewUsage(): void {
  const review = useReviewStore((state) => (state.status === "ready" ? state.review : null));
  const origin = useReviewStore((state) => state.origin);
  const gameId = useGameStore((state) => state.gameId);
  const reviewId = analyticsReviewId(review?.reviewId);
  const reviewKey = review
    ? (reviewId ?? `saved:${gameId ?? "unsaved"}:${review.createdAt}`)
    : null;
  const moves = review?.moves;

  useEffect(() => {
    if (!reviewKey || origin !== "saved") return;
    trackUsage({ type: "review_opened", reviewId, gameId: analyticsGameId(gameId) });
  }, [gameId, origin, reviewId, reviewKey]);

  useEffect(() => {
    if (!reviewKey || !moves) return;
    studyTargets.set(reviewKey, { reviewId, gameId: analyticsGameId(gameId) });
    const reviewed = new Set(moves.map((move) => move.nodeId));
    return useGameStore.subscribe((state, previous) => {
      if (state.currentNodeId === previous.currentNodeId || !reviewed.has(state.currentNodeId))
        return;
      if (!isForeground() || !hadRecentUserInput()) return;
      studyCounter.select(reviewKey, state.currentNodeId);
    });
  }, [gameId, moves, reviewId, reviewKey]);
}
