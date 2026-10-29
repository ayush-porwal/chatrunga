import { memo, type ReactNode } from "react";
import { AlertTriangle, ArrowUpToLine, Trash2 } from "lucide-react";
import { annotationLabel } from "@chaturanga/shared/chess/move-assessment";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import { IconButton } from "@/components/ui/icon-button";
import { annotationTone } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { FigureSan, keepFocusOnPress, LineRow, lineMoveClassName, type LineEntry } from "./LineRow";
import { variationText, type VariationRow } from "./move-tree-model";

const PROMOTE_ICON = <ArrowUpToLine />;

/** A move's warning (`moveFlags`), unless it carries a mark (which says more). */
function unmarkedFlag(
  annotation: unknown,
  moveFlags: ReadonlyMap<string, string> | undefined,
  nodeId: string
): string | undefined {
  return annotation ? undefined : moveFlags?.get(nodeId);
}

/** The small warning glyph of a flagged move (nothing without a flag). */
export function MoveFlagGlyph({
  flag,
  className
}: {
  flag: string | undefined;
  className?: string;
}) {
  return flag ? <AlertTriangle aria-hidden className={cn("size-3 text-warn", className)} /> : null;
}
const DELETE_ICON = <Trash2 />;

/**
 * A variation of the game as a line row (see LineRow): `9. ♙a4 ♙h6 10. ♙e4`, a neutral rule, no
 * label, indented by its nesting. Its moves are the game's own: clicking one goes to it, and the
 * current one is highlighted as on the main line. Its actions (promote, delete) act on the current
 * move when it is in this row, else on the row's first move: the pointer crosses the line's other
 * moves on its way to the icons at the row's end, so the hovered move would be a moving target.
 *
 * Memoised: stepping through the game re-renders only the rows the current move enters or leaves.
 */
export const VariationLineRow = memo(function VariationLineRow({
  row,
  gridClassName,
  currentNodeId,
  currentActions,
  moveTones,
  moveFlags,
  onMoveContextMenu,
  reviews,
  collapsedRows,
  onSelectNode,
  onDeleteLine,
  onPromoteVariation,
  onExpandRow
}: {
  row: VariationRow;
  gridClassName: string;
  /** The current move, when it is a move of this row (null otherwise). */
  currentNodeId: string | null;
  /** The current move's controls (Study's move menu), shown at the row's end at all times. */
  currentActions?: ReactNode;
  /** A class for a move's SAN by node id, unless it carries a mark (see TreeView). */
  moveTones?: ReadonlyMap<string, string>;
  /** A warning on a move by node id (see TreeView): a glyph after its SAN, the text its tooltip. */
  moveFlags?: ReadonlyMap<string, string>;
  /** A move was right-clicked (selected first): open its actions. */
  onMoveContextMenu?: (nodeId: string) => void;
  reviews?: ReadonlyMap<string, MoveReview>;
  /** Study's collapsed branches (node id → moves hidden behind it), drawn as "… N more moves". */
  collapsedRows?: ReadonlyMap<string, number>;
  onSelectNode: (nodeId: string) => void;
  onDeleteLine?: (nodeId: string) => void;
  onPromoteVariation?: (nodeId: string) => void;
  onExpandRow?: (nodeId: string) => void;
}) {
  const entries: LineEntry[] = row.moves.map(({ node, number }) => {
    const hiddenMoves = collapsedRows?.get(node.id);
    if (hiddenMoves !== undefined) {
      return {
        key: node.id,
        number: null,
        move: (
          <button
            type="button"
            className="ml-1 cursor-pointer rounded-[4px] px-1 text-xs whitespace-nowrap text-fg-subtle outline-none transition-colors duration-micro ease-standard hover:bg-fg/10 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50"
            onClick={() => onExpandRow?.(node.id)}
          >
            … {hiddenMoves} more {hiddenMoves === 1 ? "move" : "moves"}
          </button>
        )
      };
    }
    const annotation = reviews?.get(node.id)?.assessment?.annotation ?? null;
    const current = node.id === currentNodeId;
    const san = node.san ?? "–";
    const flag = unmarkedFlag(annotation, moveFlags, node.id);
    return {
      key: node.id,
      number,
      move: (
        <button
          type="button"
          data-tree-node-id={node.id}
          aria-current={current ? "step" : undefined}
          // Named by its SAN (the piece is drawn, not written).
          aria-label={san}
          title={annotation ? annotationLabel(annotation) : flag}
          className={cn(
            lineMoveClassName({
              current,
              toneClassName: annotation ? annotationTone[annotation].text : moveTones?.get(node.id)
            }),
            "cursor-pointer"
          )}
          onMouseDown={keepFocusOnPress}
          onClick={() => onSelectNode(node.id)}
          onContextMenu={
            onMoveContextMenu
              ? (event) => {
                  event.preventDefault();
                  onSelectNode(node.id);
                  onMoveContextMenu(node.id);
                }
              : undefined
          }
        >
          {node.san ? <FigureSan san={node.san} /> : san}
          <MoveFlagGlyph flag={flag} className="ml-0.5 inline" />
        </button>
      )
    };
  });

  const text = variationText(row.moves);
  const target =
    row.moves.find(({ node }) => node.id === currentNodeId)?.node ??
    row.moves.find(({ node }) => collapsedRows?.get(node.id) === undefined)?.node;
  const targetSan = target?.san ?? "the selected move";
  const actions = target ? (
    <>
      {onPromoteVariation ? (
        <IconButton
          label={`Promote the variation with ${targetSan}`}
          icon={PROMOTE_ICON}
          variant="ghost"
          size="icon-xs"
          tooltipSide="left"
          onClick={() => onPromoteVariation(target.id)}
        />
      ) : null}
      {onDeleteLine ? (
        <IconButton
          label={`Delete line from ${targetSan}`}
          icon={DELETE_ICON}
          variant="ghost-destructive"
          size="icon-xs"
          tooltipSide="left"
          onClick={() => onDeleteLine(target.id)}
        />
      ) : null}
    </>
  ) : null;

  return (
    <LineRow
      ariaLabel={`Variation: ${text || "more moves"}`}
      gridClassName={gridClassName}
      depth={row.depth}
      entries={entries}
      currentKey={currentNodeId}
      actions={onPromoteVariation || onDeleteLine ? actions : null}
      pinnedActions={currentActions}
    />
  );
});
