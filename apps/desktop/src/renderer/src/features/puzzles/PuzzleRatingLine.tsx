import { isProvisional } from "@chaturanga/shared/chess/puzzle-rating";
import type { PuzzleAttemptResult } from "@chaturanga/shared/types/puzzle-rating";
import { cn } from "@/lib/utils";
import { attemptKey, usePuzzleRecordStore } from "../../queries/puzzles";
import { usePuzzleStore } from "../../stores/puzzle-store";

/** "1523", or "1523?" while provisional (as Lichess shows it). */
export function formatPuzzleRating(rating: { rating: number; deviation: number }): string {
  return `${Math.round(rating.rating)}${isProvisional(rating) ? "?" : ""}`;
}

/** "+12", "−8", "±0". */
export function formatRatingDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `−${Math.abs(delta)}`;
  return "±0";
}

/** What the puzzle card says about the rating once the attempt is recorded. */
export function ratingLine(result: PuzzleAttemptResult): { text: string; delta: number | null } {
  if (result.rated && result.after && result.delta !== null) {
    return { text: `Your rating ${formatPuzzleRating(result.after)}`, delta: result.delta };
  }
  return {
    text:
      result.unratedReason === "already-played" ? "Already played — not rated" : "Unrated puzzle",
    delta: null
  };
}

/**
 * The active puzzle's effect on the solver's rating, once it is decided and recorded: "Your rating
 * 1523 (+12)", "Unrated puzzle", or "Already played — not rated". Nothing before that.
 */
export function PuzzleRatingLine() {
  const attemptId = usePuzzleStore((state) =>
    state.outcome !== "pending" && state.attempt ? attemptKey(state.attempt) : null
  );
  const record = usePuzzleRecordStore((state) =>
    attemptId ? state.byAttempt[attemptId] : undefined
  );
  if (!record || record.status === "saving") return null;
  if (record.status === "failed") {
    return (
      <p className="animate-fade-in text-xs text-fg-muted">
        Couldn&apos;t save this attempt: {record.message}
      </p>
    );
  }
  const { text, delta } = ratingLine(record.result);
  return (
    <p className="flex animate-fade-in items-baseline gap-1.5 text-xs text-fg-muted">
      <span className={cn(delta !== null && "font-medium tabular-nums text-fg-secondary")}>
        {text}
      </span>
      {delta !== null ? (
        <span
          className={cn(
            "font-semibold tabular-nums",
            delta > 0 ? "text-accent-fg" : delta < 0 ? "text-danger" : "text-fg-subtle"
          )}
        >
          ({formatRatingDelta(delta)})
        </span>
      ) : null}
    </p>
  );
}
