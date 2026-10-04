import { memo, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, SkipBack, SkipForward } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";

// Hoisted so the memoised IconButtons skip the per-move re-render of the row.
const firstIcon = <SkipBack />;
const previousIcon = <ChevronLeft />;
const nextIcon = <ChevronRight />;
const lastIcon = <SkipForward />;

export type MoveNavigationBarProps = {
  /** Plies from the start to the shown position. */
  depth: number;
  /** Plies in the line being counted; 0 shows "—" instead of "n / N". */
  total: number;
  /** A second line under the counter. */
  caption?: ReactNode;
  canPrevious: boolean;
  canNext: boolean;
  onFirst: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onLast: () => void;
};

/**
 * The move navigation row under a board: First / Previous · "n / N" · Next / Last. Presentational:
 * the game's MoveNavigation and the repertoire's tree navigation work out the position and moves.
 * First and Previous share `canPrevious`, Next and Last share `canNext`.
 */
export const MoveNavigationBar = memo(function MoveNavigationBar({
  depth,
  total,
  caption,
  canPrevious,
  canNext,
  onFirst,
  onPrevious,
  onNext,
  onLast
}: MoveNavigationBarProps) {
  return (
    // In a panel widened beside a resized board, the row keeps the panel's measure (the tabs'
    // width above it, plus its own padding), centred, rather than pushing its ends apart.
    <nav
      className="mx-auto flex w-full max-w-[calc(var(--workspace-panel-measure)+1.5rem)] items-center justify-between gap-2 px-3 py-2"
      aria-label="Move navigation"
    >
      <div className="flex items-center gap-1">
        <IconButton
          label="First move"
          icon={firstIcon}
          variant="outline"
          tooltipSide="top"
          disabled={!canPrevious}
          onClick={onFirst}
        />
        <IconButton
          label="Previous move"
          icon={previousIcon}
          variant="outline"
          tooltipSide="top"
          disabled={!canPrevious}
          onClick={onPrevious}
        />
      </div>
      <div className="grid min-w-0 justify-items-center gap-0.5 text-center">
        <p className="font-mono text-xs text-fg-secondary tabular-nums">
          {total ? `${depth} / ${total}` : "—"}
        </p>
        {caption ? <p className="text-2xs text-fg-subtle tabular-nums">{caption}</p> : null}
      </div>
      <div className="flex items-center gap-1">
        <IconButton
          label="Next move"
          icon={nextIcon}
          variant="outline"
          tooltipSide="top"
          disabled={!canNext}
          onClick={onNext}
        />
        <IconButton
          label="Last move"
          icon={lastIcon}
          variant="outline"
          tooltipSide="top"
          disabled={!canNext}
          onClick={onLast}
        />
      </div>
    </nav>
  );
});
