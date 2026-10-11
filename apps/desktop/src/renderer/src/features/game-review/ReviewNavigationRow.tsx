import { ChevronRight, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGameStore } from "../../stores/game-store";
import { useReviewStore } from "../../stores/review-store";
import { MoveNavigation } from "../board/MoveNavigation";
import { blackToMove, fullMoveCount } from "../board/move-counter";
import type { ReviewStepAction } from "./review-steps";

/**
 * The footer's last row, pinned to the panel's bottom: once a review is done, the review button
 * (Start review → Next insight · n of m → Finish review) right above the move navigation, on every
 * tab — the only place it lives; while one runs, the navigation is captioned with its progress.
 */
export function ReviewNavigationRow({
  step,
  onStep,
  hasReview,
  running,
  fallbackTotal,
  follow
}: {
  step: ReviewStepAction;
  onStep: () => void;
  /** The analysis shown has moves (a stopped run's count): the review button shows. */
  hasReview: boolean;
  running: boolean;
  /** The progress's total until the review reports its own: the main line's moves. */
  fallbackTotal: number;
  /** Following a running review's analysis; paused, the caption offers to resume it. */
  follow: { paused: boolean; resume: () => void };
}) {
  return (
    <div>
      {hasReview && !running ? (
        <div className="px-3 pt-2">
          <Button
            type="button"
            variant="primary"
            className="w-full"
            disabled={step.stage === "none"}
            onClick={onStep}
          >
            {step.stage === "start" ? <Play /> : null}
            {step.label}
            {step.stage === "next" ? <ChevronRight /> : null}
          </Button>
        </div>
      ) : null}
      <MoveNavigation
        caption={
          running ? (
            <ReviewProgressCaption
              fallbackTotal={fallbackTotal}
              onFollow={follow.paused ? follow.resume : undefined}
            />
          ) : null
        }
      />
    </div>
  );
}

/**
 * The single place review progress is shown. It subscribes to the progress step itself so a
 * tick re-renders only this caption, not the page, graph or panel.
 */
function ReviewProgressCaption({
  fallbackTotal,
  onFollow
}: {
  fallbackTotal: number;
  onFollow?: () => void;
}) {
  const moveIndex = useReviewStore((state) => state.progress?.moveIndex ?? null);
  const totalMoves = useReviewStore((state) => state.progress?.totalMoves ?? null);
  const blackFirst = useGameStore((state) =>
    blackToMove(state.moveTree.find((node) => !node.parentId)?.fenBefore)
  );
  const total = totalMoves ?? fallbackTotal;
  const current = moveIndex === null ? 0 : Math.min(moveIndex + 1, total);
  const percent = total ? Math.round((Math.max(current - 1, 0) / total) * 100) : 0;
  // The progress is in plies; the caption counts full moves, as the move counter does.
  const progress = current
    ? `Analyzing move ${fullMoveCount(current, blackFirst)} of ${fullMoveCount(total, blackFirst)}`
    : null;
  return (
    <span className="inline-grid justify-items-center gap-0.5">
      <span role="status" aria-label={progress ?? "Starting analysis"}>
        {progress ?? "Starting analysis…"}
      </span>
      {/* One slot under the caption, so pausing never moves the panel: the progress bar, or the
          button that follows the analysis again. */}
      <span className="grid h-4 place-items-center">
        {onFollow ? (
          <button
            type="button"
            className="font-medium text-accent underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
            onClick={onFollow}
          >
            Follow analysis
          </button>
        ) : (
          <span className="block h-0.5 w-28 overflow-hidden rounded-full bg-control" aria-hidden>
            <span
              className="block h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          </span>
        )}
      </span>
    </span>
  );
}
