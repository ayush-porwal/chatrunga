import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useGameStore } from "../../stores/game-store";
import { useReviewStore } from "../../stores/review-store";
import { useOutdatedReviewMoves } from "../../stores/review-validity";
import { blackToMove } from "../board/move-counter";
import { reviewNotices, type ReviewNotice } from "./review-notices";

/**
 * The review's notices for the game shown (rule: review-notices.ts). `totalPlies` is the main
 * line's length; `onAnalyze` (absent while the game can't be analysed) is Analyze again.
 */
export function useReviewNotices(totalPlies: number, onAnalyze?: () => void): ReviewNotice[] {
  const canAnalyze = Boolean(onAnalyze) && totalPlies > 0;
  const status = useReviewStore((state) => state.status);
  const error = useReviewStore((state) => state.error);
  // What a stopped run finished (kept after the stop, even while an earlier analysis shows).
  const analysedPlies = useReviewStore((state) => state.partialMoves.length);
  const recomputed = useReviewStore((state) => Boolean(state.review?.assessmentsRecomputed));
  const blackFirst = useGameStore((state) =>
    blackToMove(state.moveTree.find((node) => !node.parentId)?.fenBefore)
  );
  // Moves of the shown analysis the game no longer has (deleted or replaced since).
  const outdatedMoves = useOutdatedReviewMoves();
  return useMemo(
    () =>
      reviewNotices({
        status,
        error,
        analysedPlies,
        totalPlies,
        blackFirst,
        outdatedMoves,
        recomputed,
        canAnalyze
      }),
    [analysedPlies, blackFirst, canAnalyze, error, outdatedMoves, recomputed, status, totalPlies]
  );
}

/**
 * The panel's notices, in their own full-width section between the tab bar and the tab content:
 * one tinted band each, the first with Analyze again when it's offered.
 */
export function ReviewNotices({
  notices,
  onAnalyze
}: {
  notices: readonly ReviewNotice[];
  onAnalyze?: () => void;
}) {
  if (!notices.length) return null;
  return (
    <div className="shrink-0 border-b border-line-subtle">
      {notices.map((notice) => (
        <Notice
          key={notice.key}
          tone={notice.tone}
          appear={false}
          className="items-center rounded-none border-0 border-b border-line-subtle px-3 py-2.5 last:border-b-0 [&>svg]:mt-0"
          action={
            notice.analyze && onAnalyze ? (
              <Button type="button" variant="outline" size="xs" onClick={onAnalyze}>
                Analyze again
              </Button>
            ) : undefined
          }
        >
          {notice.text}
        </Notice>
      ))}
    </div>
  );
}
