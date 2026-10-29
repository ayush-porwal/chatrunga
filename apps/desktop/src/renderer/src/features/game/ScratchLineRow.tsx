import { memo } from "react";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { CornerUpLeft } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import { FigureSan, keepFocusOnPress, LineRow, lineMoveClassName } from "./LineRow";
import { bestLineText, lineMoveNumber, scratchRowNodeId } from "./move-list-model";
import type { ScratchLine } from "./scratch-line";
import type { ExtraLineRow } from "./TreeView";

/**
 * The scratch line's row for the move list (TreeView's `scratchRow`), under the pair of the game
 * move it was tried from; none without a line.
 */
export function scratchLineRow(
  nodes: readonly MoveNode[],
  line: ScratchLine | null,
  onBrowse: (line: ScratchLine) => void,
  onLeave: () => void
): ExtraLineRow | undefined {
  const startFen = line && nodes.find((node) => node.id === line.anchorNodeId)?.fenAfter;
  if (!line || !startFen) return undefined;
  return {
    afterNodeId: scratchRowNodeId(nodes, line.originNodeId),
    render: (gridClassName) => (
      <ScratchLineRow
        line={line}
        startFen={startFen}
        gridClassName={gridClassName}
        onBrowse={onBrowse}
        onLeave={onLeave}
      />
    )
  };
}

/**
 * The scratch line's row (Game review: moves tried on the board or a coach's line clicked), under
 * the pair of the game move it was started from: `NOT SAVED 12… ♘c5 13. ♘d2`, ruled in the accent
 * colour, a line row as a BEST line's. Clicking a move shows its position (←/→ step along the line
 * too); Back to game, always shown at its end, leaves it. It is never part of the game.
 */
const ScratchLineRow = memo(function ScratchLineRow({
  line,
  startFen,
  gridClassName,
  onBrowse,
  onLeave
}: {
  line: ScratchLine;
  /** The position before its first move (its anchor's), for the move numbers. */
  startFen: string;
  /** The list's column template, so the row starts at the move column. */
  gridClassName: string;
  onBrowse: (line: ScratchLine) => void;
  onLeave: () => void;
}) {
  const moves = line.moves.map((move, index) => ({
    ...move,
    number: lineMoveNumber(startFen, index)
  }));
  const entries = moves.map((move, index) => {
    const current = index === line.index;
    return {
      key: `${index}-${move.uci}`,
      number: move.number,
      move: (
        <button
          type="button"
          aria-label={`Show ${bestLineText(moves.slice(0, index + 1))} on the board`}
          aria-current={current ? "step" : undefined}
          data-scratch-move={move.san}
          className={cn(lineMoveClassName({ current }), "cursor-pointer")}
          onMouseDown={keepFocusOnPress}
          onClick={() => onBrowse({ ...line, index })}
        >
          <FigureSan san={move.san} />
        </button>
      )
    };
  });
  return (
    <LineRow
      ariaLabel={`Moves tried, not saved: ${bestLineText(moves)}`}
      gridClassName={gridClassName}
      ruleColor="var(--color-accent)"
      label="Not saved"
      entries={entries}
      currentKey={entries[line.index]?.key ?? null}
      pinnedActions={
        <IconButton
          label="Back to game"
          icon={<CornerUpLeft />}
          size="icon-xs"
          tooltipSide="left"
          onMouseDown={keepFocusOnPress}
          onClick={onLeave}
        />
      }
    />
  );
});
