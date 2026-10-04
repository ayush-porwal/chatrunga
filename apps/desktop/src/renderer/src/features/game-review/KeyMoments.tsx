import { memo, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { MoveAssessment, MoveReview } from "@chaturanga/shared/types/engine";
import { adjacentMoment, type KeyMoment } from "@chaturanga/shared/chess/key-moments";
import { assessmentReason } from "@chaturanga/shared/chess/move-assessment";
import { AnnotationBadge } from "@/components/ui/annotation-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { listRowInteractive, listRowSelected } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { moveLabel } from "./review-utils";

/**
 * Why the selected move carries its mark, in one plain sentence — or, for an unmarked engine
 * match, that it was the engine's choice (information, not praise). Nothing for other moves.
 */
export function MoveMarkNote({
  assessment,
  className
}: {
  assessment: MoveAssessment | undefined;
  className?: string;
}) {
  const reason =
    assessmentReason(assessment) ??
    (assessment?.tags.includes("engine_top") ? "The engine's top choice." : null);
  if (!reason) return null;
  return <p className={cn("text-xs leading-5 text-fg-muted", className)}>{reason}</p>;
}

/**
 * A list of marked moves (the key moments, or every mark): the move, its mark and why. Selecting
 * a row goes to that move.
 */
export const MomentList = memo(function MomentList({
  moments,
  moves,
  selectedNodeId,
  onSelectNode,
  label,
  emptyTitle,
  className
}: {
  moments: readonly KeyMoment[];
  moves: readonly MoveReview[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  /** Accessible name of the list. */
  label: string;
  emptyTitle: string;
  className?: string;
}) {
  const byNode = useMemo(() => new Map(moves.map((move) => [move.nodeId, move])), [moves]);
  if (!moments.length) return <EmptyState compact title={emptyTitle} />;
  return (
    <ol aria-label={label} className={cn("grid gap-1.5", className)}>
      {moments.map((moment) => {
        const move = byNode.get(moment.nodeId);
        if (!move) return null;
        const selected = moment.nodeId === selectedNodeId;
        return (
          <li key={moment.nodeId}>
            <button
              type="button"
              aria-current={selected ? "step" : undefined}
              className={cn(
                listRowInteractive,
                "min-h-0 items-start gap-2 py-1.5",
                selected && listRowSelected
              )}
              onClick={() => onSelectNode(moment.nodeId)}
            >
              <span className="w-16 shrink-0 font-mono text-sm font-semibold text-fg">
                {moveLabel(move)}
              </span>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <AnnotationBadge annotation={moment.annotation} className="justify-self-start" />
                <span className="text-xs leading-4 text-fg-muted">
                  {assessmentReason(move.assessment)}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
});

const PREVIOUS_ICON = <ChevronLeft />;
const NEXT_ICON = <ChevronRight />;

/**
 * Steps through the key moments from the selected move: Previous / Next, and which moment the
 * board is on ("Key moment 2 of 4", or how many there are when it is on none).
 */
export const KeyMomentNav = memo(function KeyMomentNav({
  moments,
  selectedPly,
  onSelectNode
}: {
  moments: readonly KeyMoment[];
  /** Ply of the selected move (0 at the start; the anchor's ply on a variation). */
  selectedPly: number;
  onSelectNode: (nodeId: string) => void;
}) {
  if (!moments.length) return null;
  const previous = adjacentMoment(moments, selectedPly, "previous");
  const next = adjacentMoment(moments, selectedPly, "next");
  const index = moments.findIndex((moment) => moment.ply === selectedPly);
  const status =
    index >= 0
      ? `Key moment ${index + 1} of ${moments.length}`
      : `${moments.length} key ${moments.length === 1 ? "moment" : "moments"}`;
  return (
    <div role="group" aria-label="Key moments" className="flex items-center gap-0.5">
      <IconButton
        label="Previous key moment"
        icon={PREVIOUS_ICON}
        size="icon-xs"
        tooltipSide="top"
        disabled={!previous}
        onClick={() => previous && onSelectNode(previous.nodeId)}
      />
      <span
        className="min-w-0 truncate px-0.5 text-2xs text-fg-muted tabular-nums"
        aria-live="polite"
      >
        {status}
      </span>
      <IconButton
        label="Next key moment"
        icon={NEXT_ICON}
        size="icon-xs"
        tooltipSide="top"
        disabled={!next}
        onClick={() => next && onSelectNode(next.nodeId)}
      />
    </div>
  );
});
