import { GraduationCap } from "lucide-react";
import type { ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import type { TrainingBlocker } from "@chaturanga/shared/chess/repertoire-training";
import type { RepertoireColor, RepertoireNodeMeta } from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { blockerExplanation, trainingFix } from "./training-explanations";

/**
 * The study panel's last row: Practice (the repertoire's practice settings; the cog says what they
 * are). When the open chapter practises nothing, one quiet line says why, with its one-click fix
 * ("Include in practice", or removing the mark in the way); a fix that would add moves where other
 * chapters answer differently asks first (`widening`).
 */
export function StudyPracticeFooter({
  blocker,
  chapterTitle,
  lookup,
  color,
  busy,
  widening,
  onMakeTrainable,
  onConfirmWidening,
  onCancelWidening,
  onSetMeta,
  onPractice
}: {
  /** Why the open chapter practises nothing (null: it practises something). */
  blocker: TrainingBlocker | null;
  chapterTitle: string;
  lookup: ChapterLookup;
  color: RepertoireColor;
  busy: boolean;
  /** The question "Include in practice" is waiting on, or null. */
  widening: string | null;
  onMakeTrainable: () => void;
  onConfirmWidening: () => void;
  onCancelWidening: () => void;
  onSetMeta: (nodeId: string, patch: Partial<RepertoireNodeMeta>) => void;
  onPractice: () => void;
}) {
  const explanation = blocker ? blockerExplanation(blocker, chapterTitle, lookup, color) : null;
  const fix = blocker ? trainingFix(blocker) : null;
  return (
    <div className="grid gap-1.5 border-t border-line-subtle px-3 py-2">
      {explanation ? (
        <p className="text-2xs leading-4 text-fg-subtle" title={explanation.more}>
          {explanation.title}.
          {fix ? (
            <>
              {" "}
              <Button
                type="button"
                variant="link"
                size="xs"
                className="text-2xs"
                title={fix.description}
                disabled={busy}
                onClick={() =>
                  fix.kind === "make-trainable"
                    ? onMakeTrainable()
                    : onSetMeta(fix.nodeId, fix.patch)
                }
              >
                {fix.label}
              </Button>
            </>
          ) : null}
        </p>
      ) : null}
      <Button
        type="button"
        variant="primary"
        size="sm"
        title="Due positions first, then new ones (the repertoire settings say which)"
        onClick={onPractice}
      >
        <GraduationCap />
        Practice
      </Button>
      {widening ? (
        <Dialog
          size="sm"
          title="Include in practice?"
          description={widening}
          onClose={onCancelWidening}
          footer={
            <>
              <Button type="button" variant="outline" size="sm" onClick={onCancelWidening}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={busy}
                onClick={onConfirmWidening}
              >
                Include anyway
              </Button>
            </>
          }
        />
      ) : null}
    </div>
  );
}
