import { useId } from "react";
import { Crosshair, GraduationCap } from "lucide-react";
import type { ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import type { TrainingBlocker } from "@chaturanga/shared/chess/repertoire-training";
import type { RepertoireColor, RepertoireNodeMeta } from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { blockerExplanation, blockerFocusNodeId, trainingFix } from "./training-explanations";

/**
 * Above the move tree of a chapter with nothing to practise: the cause in one sentence (the
 * chapter, a reference move, a training mark), the one-click fix and a way to see the move in
 * question. What the fix does, and more about the cause, is the fix's description (its tooltip,
 * and read with it). "Include in practice" that would add moves to positions other chapters
 * answer differently asks first (`widening`).
 */
export function StudyTrainingNotice({
  blocker,
  chapterTitle,
  lookup,
  color,
  selectedNodeId,
  busy,
  widening,
  onMakeTrainable,
  onConfirmWidening,
  onCancelWidening,
  onSetMeta,
  onSelectNode
}: {
  blocker: TrainingBlocker;
  chapterTitle: string;
  lookup: ChapterLookup;
  color: RepertoireColor;
  selectedNodeId: string;
  busy: boolean;
  /** The question "Include in practice" is waiting on (see wideningQuestion), or null. */
  widening: string | null;
  onMakeTrainable: () => void;
  onConfirmWidening: () => void;
  onCancelWidening: () => void;
  onSetMeta: (nodeId: string, patch: Partial<RepertoireNodeMeta>) => void;
  onSelectNode: (nodeId: string) => void;
}) {
  const descriptionId = useId();
  const { detail, more } = blockerExplanation(blocker, chapterTitle, lookup, color);
  const fix = trainingFix(blocker);
  const focus = blockerFocusNodeId(blocker, lookup);
  const description = [more, fix?.description].filter(Boolean).join(" ");
  return (
    <Notice tone="warn" appear={false} aria-label="Why nothing is practised">
      <p>{detail}</p>
      {widening ? (
        <div className="mt-2 grid gap-1.5" role="group" aria-label="Include in practice?">
          <p className="text-fg">{widening}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              variant="primary"
              size="xs"
              disabled={busy}
              onClick={onConfirmWidening}
            >
              <GraduationCap />
              Include anyway
            </Button>
            <Button type="button" variant="ghost" size="xs" onClick={onCancelWidening}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {fix ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="primary"
                  size="xs"
                  disabled={busy}
                  aria-describedby={descriptionId}
                  onClick={() =>
                    fix.kind === "make-trainable"
                      ? onMakeTrainable()
                      : onSetMeta(fix.nodeId, fix.patch)
                  }
                >
                  <GraduationCap />
                  {fix.label}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-72">
                {description}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {focus !== selectedNodeId ? (
            <Button type="button" variant="ghost" size="xs" onClick={() => onSelectNode(focus)}>
              <Crosshair />
              Show the move
            </Button>
          ) : null}
        </div>
      )}
      {description ? (
        <p id={descriptionId} className="sr-only">
          {description}
        </p>
      ) : null}
    </Notice>
  );
}
