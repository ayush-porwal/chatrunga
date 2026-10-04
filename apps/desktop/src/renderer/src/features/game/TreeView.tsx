import { Fragment, memo, useEffect, useMemo, useRef, type ReactNode } from "react";
import { ArrowUpToLine, Check, Trash2 } from "lucide-react";
import { reviewLabel } from "@chaturanga/shared/chess/review";
import { formatMoveEval } from "../game-review/review-score";
import type { MoveReview, ReviewCommentary } from "@chaturanga/shared/types/engine";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import {
  buildTreeModel,
  movePrefix,
  type TreeVariationBlock,
  type TreeVariationRow
} from "./move-tree-model";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import { QualityBadge } from "@/components/ui/quality-badge";
import { isRapidNavigation, usePrefersReducedMotion } from "../board/board-motion";

const ROOT_ID = "root";
/** Deeper variations stop indenting (the depth is still in the row's title). */
const MAX_VISUAL_DEPTH = 8;

type TreeViewProps = {
  nodes: readonly MoveNode[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  reviews?: ReadonlyMap<string, MoveReview>;
  commentaryByNodeId?: ReadonlyMap<string, ReviewCommentary>;
  showScores?: boolean;
  showCommentaryState?: boolean;
  onDeleteLine?: (nodeId: string) => void;
  /** Offered on a selected move inside a variation: moves that variation up (see its owner). */
  onPromoteVariation?: (nodeId: string) => void;
  emptyLabel?: ReactNode;
  className?: string;
  ariaLabel?: string;
  /**
   * Rows standing for collapsed branches (node id → moves hidden behind it): drawn as one
   * "… N more moves" row that calls `onExpandRow` instead of selecting a move.
   */
  collapsedRows?: ReadonlyMap<string, number>;
  onExpandRow?: (nodeId: string) => void;
};

export function TreeView({
  nodes,
  selectedNodeId,
  onSelectNode,
  reviews,
  commentaryByNodeId,
  showScores = false,
  showCommentaryState = false,
  onDeleteLine,
  onPromoteVariation,
  emptyLabel = "No moves yet.",
  className,
  ariaLabel = "Move tree",
  collapsedRows,
  onExpandRow
}: TreeViewProps) {
  const model = useMemo(() => buildTreeModel(nodes, ROOT_ID), [nodes]);
  const listRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  // Keep the current move in view inside the list only (never scrolls the page or the panel),
  // clear of the sticky header; glides for single steps, jumps while scrubbing.
  useEffect(() => {
    const list = listRef.current;
    if (!selectedNodeId || !list) return;
    const active = list.querySelector<HTMLElement>(
      `[data-tree-node-id="${CSS.escape(selectedNodeId)}"]`
    );
    if (!active) return;
    const listBox = list.getBoundingClientRect();
    const box = active.getBoundingClientRect();
    const top = listBox.top + (headerRef.current?.offsetHeight ?? 0) + SCROLL_MARGIN;
    const bottom = listBox.bottom - SCROLL_MARGIN;
    let delta = 0;
    if (box.top < top) delta = box.top - top;
    else if (box.bottom > bottom) delta = box.bottom - bottom;
    if (!delta) return;
    const smooth =
      !reducedMotion && !isRapidNavigation() && Math.abs(delta) < list.clientHeight * 2;
    list.scrollTo({ top: list.scrollTop + delta, behavior: smooth ? "smooth" : "auto" });
  }, [selectedNodeId, model, reducedMotion]);

  const hasMoves =
    model.mainline.length > 0 || model.rootVariations.some((block) => block.rows.length);
  if (!hasMoves) {
    return <EmptyState compact title={emptyLabel} />;
  }

  const renderVariationBlocks = (blocks: TreeVariationBlock[] | undefined) =>
    blocks?.map((block, blockIndex) =>
      block.rows.map((row, rowIndex) => {
        const hiddenMoves = collapsedRows?.get(row.node.id);
        if (hiddenMoves !== undefined) {
          return (
            <CollapsedRow
              key={`${row.node.id}-${blockIndex}-${rowIndex}`}
              row={row}
              hiddenMoves={hiddenMoves}
              onExpand={onExpandRow}
            />
          );
        }
        return (
          <VariationRow
            key={`${row.node.id}-${blockIndex}-${rowIndex}`}
            row={row}
            selected={selectedNodeId === row.node.id}
            review={reviews?.get(row.node.id)}
            commentary={commentaryByNodeId?.get(row.node.id)}
            showScores={showScores}
            showCommentaryState={showCommentaryState}
            onSelectNode={onSelectNode}
            onDeleteLine={onDeleteLine}
            onPromoteVariation={onPromoteVariation}
          />
        );
      })
    );

  const cell = (node: MoveNode | undefined) =>
    node ? (
      <TreeNodeButton
        node={node}
        selected={selectedNodeId === node.id}
        review={reviews?.get(node.id)}
        commentary={commentaryByNodeId?.get(node.id)}
        showScores={showScores}
        showCommentaryState={showCommentaryState}
        onSelectNode={onSelectNode}
        onDeleteLine={onDeleteLine}
        onPromoteVariation={onPromoteVariation}
      />
    ) : (
      <span aria-hidden="true" />
    );

  return (
    <div
      ref={listRef}
      className={cn("scroll-area min-h-0 overflow-y-auto", className)}
      role="tree"
      aria-label={ariaLabel}
    >
      <div
        ref={headerRef}
        className="sticky top-0 z-10 mb-1 grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)] gap-1 border-b border-line-subtle bg-surface py-1.5 text-xs text-fg-muted"
      >
        <span className="text-center">#</span>
        <span className="px-2">White</span>
        <span className="px-2">Black</span>
      </div>
      <div className="grid gap-0.5">
        {selectedNodeId === ROOT_ID ? (
          <button
            type="button"
            data-tree-node-id={ROOT_ID}
            aria-current="step"
            aria-selected="true"
            role="treeitem"
            aria-level={1}
            className="flex h-8 items-center rounded-md bg-accent-strong px-2 text-left text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            onClick={() => onSelectNode(ROOT_ID)}
          >
            Starting position
          </button>
        ) : null}
        {renderVariationBlocks(model.rootVariations)}
        {model.mainline.map((row) => {
          const whiteId = row.white?.id;
          const blackId = row.black?.id;
          return (
            <Fragment key={`main-${row.number}-${whiteId ?? "empty"}-${blackId ?? "empty"}`}>
              <div
                className="grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)] items-stretch gap-1"
                role="row"
                aria-level={1}
              >
                <span className="flex items-center justify-center font-mono text-2xs text-fg-subtle tabular-nums">
                  {row.number}.
                </span>
                {cell(row.white)}
                {cell(row.black)}
              </div>
              {renderVariationBlocks(whiteId ? model.variationsByParent.get(whiteId) : undefined)}
              {renderVariationBlocks(blackId ? model.variationsByParent.get(blackId) : undefined)}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

/** Room kept between the current move and the list's edges when scrolling it into view. */
const SCROLL_MARGIN = 8;

type NodeButtonProps = {
  node: MoveNode;
  selected: boolean;
  review?: MoveReview;
  commentary?: ReviewCommentary;
  showScores: boolean;
  showCommentaryState: boolean;
  variation?: boolean;
  onSelectNode: (nodeId: string) => void;
  onDeleteLine?: (nodeId: string) => void;
  onPromoteVariation?: (nodeId: string) => void;
};

/** Memoised: stepping through a game re-renders only the two rows whose selection changed. */
const VariationRow = memo(function VariationRow({
  row,
  ...button
}: Omit<NodeButtonProps, "node" | "variation"> & { row: TreeVariationRow }) {
  const visualDepth = Math.min(row.depth, MAX_VISUAL_DEPTH);
  const hiddenDepth = Math.max(0, row.depth - MAX_VISUAL_DEPTH);
  return (
    <div
      className="grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)] items-stretch gap-1 border-l border-line-strong"
      style={{ paddingInlineStart: `${visualDepth * 12 + 4}px` }}
      data-tree-depth={row.depth}
      data-branch-start={row.branchStart ? "true" : undefined}
      role="treeitem"
      aria-level={row.depth + 1}
      title={hiddenDepth ? `Variation depth ${row.depth}` : undefined}
    >
      <span className="flex items-center justify-center font-mono text-2xs text-fg-subtle tabular-nums">
        {movePrefix(row.node)}
      </span>
      <div className="col-span-2 min-w-0">
        <TreeNodeButton node={row.node} variation {...button} />
      </div>
    </div>
  );
});

/** A collapsed branch: one row that expands the moves hidden behind it. */
const CollapsedRow = memo(function CollapsedRow({
  row,
  hiddenMoves,
  onExpand
}: {
  row: TreeVariationRow;
  hiddenMoves: number;
  onExpand?: (nodeId: string) => void;
}) {
  const visualDepth = Math.min(row.depth, MAX_VISUAL_DEPTH);
  return (
    <div
      className="border-l border-line-strong"
      style={{ paddingInlineStart: `${visualDepth * 12 + 4}px` }}
      data-tree-depth={row.depth}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={false}
    >
      <button
        type="button"
        className="flex h-7 w-full items-center rounded-md px-2 text-left text-xs text-fg-subtle outline-none transition-colors duration-micro ease-standard hover:bg-control hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50"
        onClick={() => onExpand?.(row.node.id)}
      >
        … {hiddenMoves} more {hiddenMoves === 1 ? "move" : "moves"}
      </button>
    </div>
  );
});

const TreeNodeButton = memo(function TreeNodeButton({
  node,
  selected,
  review,
  commentary,
  showScores,
  showCommentaryState,
  variation = false,
  onSelectNode,
  onDeleteLine,
  onPromoteVariation
}: NodeButtonProps) {
  const title = review
    ? `${reviewLabel(review.classification)} · ${formatMoveEval(review)}`
    : variation
      ? `Variation: ${node.san ?? "move"}`
      : (node.san ?? "Move");

  const showDelete = selected && Boolean(onDeleteLine);
  const showPromote = selected && variation && Boolean(onPromoteVariation);

  return (
    <div className="group relative min-w-0">
      <button
        type="button"
        data-tree-node-id={node.id}
        aria-current={selected ? "step" : undefined}
        className={cn(
          "flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left outline-none",
          "transition-[background-color,color,box-shadow] duration-micro ease-standard focus-visible:ring-2 focus-visible:ring-accent/50",
          selected
            ? "bg-accent-strong text-fg shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]"
            : variation
              ? "text-fg-muted hover:bg-control hover:text-fg"
              : "text-fg-secondary hover:bg-control hover:text-fg",
          (showDelete || showPromote) && (showDelete && showPromote ? "pr-15" : "pr-8")
        )}
        title={title}
        onClick={() => onSelectNode(node.id)}
      >
        <span className={cn("truncate font-mono text-sm", selected && "font-semibold")}>
          {node.san ?? "–"}
        </span>
        {variation ? <span className="shrink-0 text-fg-subtle">↳</span> : null}
        {review ? (
          <QualityBadge
            variant="glyph"
            classification={review.classification}
            selected={selected}
          />
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {showScores && review ? (
            <span
              className={cn(
                "font-mono text-2xs tabular-nums",
                selected ? "text-fg/80" : "text-fg-subtle"
              )}
            >
              {formatMoveEval(review)}
            </span>
          ) : null}
          {showCommentaryState && commentary ? (
            <Check
              aria-label="Commentary ready"
              className={cn("size-3", selected ? "text-fg" : "text-accent")}
            />
          ) : null}
        </span>
      </button>
      {showPromote ? (
        <IconButton
          label={`Promote the variation with ${node.san ?? "the selected move"}`}
          icon={<ArrowUpToLine />}
          variant="ghost"
          size="icon-xs"
          tooltipSide="left"
          className={cn(
            "absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
            showDelete ? "right-8" : "right-0.5"
          )}
          onClick={(event) => {
            event.stopPropagation();
            onPromoteVariation?.(node.id);
          }}
        />
      ) : null}
      {showDelete ? (
        <IconButton
          label={`Delete line from ${node.san ?? "selected move"}`}
          icon={<Trash2 />}
          variant="ghost-destructive"
          size="icon-xs"
          tooltipSide="left"
          className="absolute right-0.5 top-1/2 -translate-y-1/2 opacity-0 hover:bg-danger-soft group-hover:opacity-100 focus-visible:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            onDeleteLine?.(node.id);
          }}
        />
      ) : null}
    </div>
  );
});
