import { GraduationCap, Route } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { StudyPracticeAvailability } from "./training-explanations";

/**
 * The chapter's status line and its two actions, Rehearse (when offered) and Practice. The status
 * line wraps (never cut off); the actions share one row, their labels shortened in a narrow panel
 * (the names stay whole for assistive tech).
 */
export function StudyPracticeBar({
  reasonId,
  availability,
  onPractice,
  onRehearse
}: {
  /** The status line's id: a disabled action is described by it. */
  reasonId: string;
  availability: StudyPracticeAvailability;
  onPractice: () => void;
  /** Rehearse this chapter (absent: no Rehearse button). */
  onRehearse: (() => void) | undefined;
}) {
  return (
    <div className="grid gap-2 border-t border-line-subtle px-3 py-2">
      <p id={reasonId} className="text-2xs leading-4 text-fg-subtle">
        {availability.practice ??
          availability.rehearse ??
          "Play a move on the board to add a variation."}
      </p>
      <div className={cn("grid gap-2", onRehearse && "grid-cols-2")}>
        {onRehearse ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Rehearse this chapter"
            title={
              availability.rehearse ??
              "Play your moves along this chapter's lines, with the replies supplied"
            }
            disabled={availability.rehearse !== null}
            aria-describedby={availability.rehearse ? reasonId : undefined}
            onClick={onRehearse}
          >
            <Route />
            <span>
              Rehearse<span className="hidden @[26rem]/panel:inline"> this chapter</span>
            </span>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="primary"
          size="sm"
          aria-label="Practice this chapter"
          title={availability.practice ?? "Practise this chapter's decisions"}
          disabled={availability.practice !== null}
          aria-describedby={availability.practice ? reasonId : undefined}
          onClick={onPractice}
        >
          <GraduationCap />
          <span>
            Practice<span className="hidden @[26rem]/panel:inline"> this chapter</span>
          </span>
        </Button>
      </div>
    </div>
  );
}
