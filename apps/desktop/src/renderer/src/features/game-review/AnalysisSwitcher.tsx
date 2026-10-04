import { useState } from "react";
import { reviewInfoLabel } from "@chaturanga/shared/chess/review-info";
import { Select } from "@/components/ui/input";
import { useGameStore } from "../../stores/game-store";
import { useReviewStore } from "../../stores/review-store";
import { showSavedAnalysis } from "../game/saved-game";

/**
 * Which of the game's saved analyses Game review shows (each with its own AI commentary). Only
 * when there's more than one; locked while a review runs.
 */
export function AnalysisSwitcher() {
  const analyses = useReviewStore((state) => state.analyses);
  const shownId = useReviewStore((state) => state.review?.reviewId ?? null);
  const running = useReviewStore((state) => state.status === "running");
  const gameId = useGameStore((state) => state.gameId);
  const [loading, setLoading] = useState(false);
  if (analyses.length < 2 || !gameId) return null;
  const value = analyses.some((info) => info.reviewId === shownId)
    ? shownId!
    : analyses[0]!.reviewId;
  return (
    <Select
      aria-label="Analysis"
      value={value}
      disabled={running || loading}
      onChange={(event) => {
        const reviewId = event.target.value;
        setLoading(true);
        void showSavedAnalysis(gameId, reviewId)
          .catch(() => false)
          .finally(() => setLoading(false));
      }}
      className="h-8 w-[30rem] max-w-[45vw] text-xs"
    >
      {analyses.map((info, index) => (
        <option key={info.reviewId} value={info.reviewId}>
          {index === 0 ? "Latest · " : ""}
          {reviewInfoLabel(info)}
        </option>
      ))}
    </Select>
  );
}
