import { useId } from "react";
import { Crosshair, GraduationCap } from "lucide-react";
import type { ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import type { TrainingBlocker } from "@chaturanga/shared/chess/repertoire-training";
import type { RepertoireColor, RepertoireNodeMeta } from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { blockerExplanation, blockerFocusNodeId, trainingFix } from "./training-explanations";

/**
 * Above the move tree of a chapter with nothing to practise: why (the chapter, a reference move,
 * a training mark), with the one-click fix and a way to see the move in question.
 */
export function StudyTrainingNotice({
  blocker,
  chapterTitle,
  lookup,
  color,
  selectedNodeId,
  busy,
  onMakeTrainable,
  onSetMeta,
  onSelectNode
}: {
  blocker: TrainingBlocker;
  chapterTitle: string;
  lookup: ChapterLookup;
  color: RepertoireColor;
  selectedNodeId: string;
  busy: boolean;
  onMakeTrainable: () => void;
  onSetMeta: (nodeId: string, patch: Partial<RepertoireNodeMeta>) => void;
  onSelectNode: (nodeId: string) => void;
}) {
  const descriptionId = useId();
  const { title, detail } = blockerExplanation(blocker, chapterTitle, lookup, color);
  const fix = trainingFix(blocker);
  const focus = blockerFocusNodeId(blocker, lookup);
  return (
    <Notice tone="warn" title={title} appear={false} aria-label="Why nothing is practised">
      <p>{detail}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {fix ? (
          <Button
            type="button"
            variant="primary"
            size="xs"
            disabled={busy}
            aria-describedby={descriptionId}
            onClick={() =>
              fix.kind === "make-trainable" ? onMakeTrainable() : onSetMeta(fix.nodeId, fix.patch)
            }
          >
            <GraduationCap />
            {fix.label}
          </Button>
        ) : null}
        {focus !== selectedNodeId ? (
          <Button type="button" variant="ghost" size="xs" onClick={() => onSelectNode(focus)}>
            <Crosshair />
            Show the move
          </Button>
        ) : null}
      </div>
      {fix ? (
        <p id={descriptionId} className="mt-1 text-2xs text-fg-subtle">
          {fix.description}
        </p>
      ) : null}
    </Notice>
  );
}
