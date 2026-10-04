import { memo, useId, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import { adjacentMoment, type KeyMoment } from "@chaturanga/shared/chess/key-moments";
import { annotationLabel } from "@chaturanga/shared/chess/move-assessment";
import { AnnotationBadge } from "@/components/ui/annotation-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { listRowSelected } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { moveLabel } from "./review-utils";
import { MomentCommentary, useCardCommentary } from "./MomentCommentary";
import { Figurine } from "../board/Figurine";
import { useBoardAppearance } from "../board/useBoardAppearance";
import { bareSan, sanPiece } from "../game/move-list-model";

/**
 * The key insights as cards (the key moments: the reviewed side's strongest marked moves), one row
 * each: the move with the board's piece and its mark. Selecting a card goes to that move. With AI
 * commentary on, each card is an accordion item: its chevron opens the move's commentary (the
 * Commentary tab's own) inside the card, one card open at a time. With it off, cards hold no text
 * of any kind beyond the move and mark, and don't open.
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
  const commentary = useCardCommentary();
  const { pieceClassName } = useBoardAppearance();
  // The one open card (accordion): opening another closes it.
  const [openId, setOpenId] = useState<string | null>(null);
  const bodyIds = useId();
  if (!moments.length) return <EmptyState compact title={emptyTitle} />;
  return (
    <ol
      aria-label={label}
      // The board's piece set, so each move's piece is the board's own (as in the move list).
      className={cn("cg-wrap grid gap-1.5", pieceClassName, className)}
      // Unlayered `.cg-wrap` rules (display: block, board.css inline-size containment) would lay this out.
      style={{ display: "grid", containerType: "normal" }}
    >
      {moments.map((moment) => {
        const move = byNode.get(moment.nodeId);
        if (!move) return null;
        const selected = moment.nodeId === selectedNodeId;
        const open = Boolean(commentary) && openId === moment.nodeId;
        const bodyId = `${bodyIds}-${moment.nodeId}`;
        return (
          <li
            key={moment.nodeId}
            className={cn(
              "overflow-hidden rounded-lg border border-line bg-surface transition-colors duration-micro",
              selected && listRowSelected
            )}
          >
            <button
              type="button"
              aria-label={`${moveLabel(move)}, ${annotationLabel(moment.annotation)}`}
              aria-current={selected ? "step" : undefined}
              aria-expanded={commentary ? open : undefined}
              aria-controls={commentary ? bodyId : undefined}
              className="flex min-h-9 w-full items-center gap-2 px-2.5 py-1.5 text-left outline-none transition-colors duration-micro hover:bg-control/60 focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-inset"
              onClick={() => {
                if (commentary) setOpenId(open ? null : moment.nodeId);
                onSelectNode(moment.nodeId);
              }}
            >
              {commentary ? (
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "size-3.5 shrink-0 text-fg-subtle transition-transform duration-micro ease-standard",
                    !open && "-rotate-90"
                  )}
                />
              ) : null}
              <span className="flex min-w-0 flex-1 items-baseline gap-1 font-mono text-sm font-semibold text-fg">
                <span className="text-fg-muted">{moveNumberLabel(move.ply)}</span>
                <span className="inline-flex items-baseline">
                  <Figurine role={sanPiece(move.san)} />
                  {bareSan(move.san)}
                </span>
              </span>
              <AnnotationBadge annotation={moment.annotation} />
            </button>
            {commentary ? (
              <div id={bodyId} hidden={!open} className="border-t border-line-subtle px-3 py-2.5">
                {open ? <MomentCommentary move={move} moves={moves} options={commentary} /> : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
});

/** "4." before White's move, "4…" before Black's. */
function moveNumberLabel(ply: number): string {
  const number = Math.ceil(ply / 2);
  return ply % 2 === 1 ? `${number}.` : `${number}…`;
}

const PREVIOUS_ICON = <ChevronLeft />;
const NEXT_ICON = <ChevronRight />;

/**
 * Steps through the key moments ("key insights" to the user) from the selected move: Previous /
 * Next, and which one the board is on ("Key insight 2 of 4", or how many there are when it is on
 * none).
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
      ? `Key insight ${index + 1} of ${moments.length}`
      : `${moments.length} key ${moments.length === 1 ? "insight" : "insights"}`;
  return (
    <div role="group" aria-label="Key insights" className="flex items-center gap-0.5">
      <IconButton
        label="Previous key insight"
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
        label="Next key insight"
        icon={NEXT_ICON}
        size="icon-xs"
        tooltipSide="top"
        disabled={!next}
        onClick={() => next && onSelectNode(next.nodeId)}
      />
    </div>
  );
});
