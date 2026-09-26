import { Fragment, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Check, CircleDashed, Trash2 } from "lucide-react";
import { reviewLabel } from "@chaturanga/shared/chess/review";
import { formatMoveEval } from "../game-review/review-score";
import type { MoveReview, ReviewCommentary } from "@chaturanga/shared/types/engine";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { buildTreeModel, movePrefix, type TreeVariationBlock, type TreeVariationRow } from "./move-tree-model";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import { QualityBadge } from "@/components/ui/quality-badge";

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
  emptyLabel?: ReactNode;
  className?: string;
  ariaLabel?: string;
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
  emptyLabel = "No moves yet.",
  className,
  ariaLabel = "Move tree"
}: TreeViewProps) {
  const model = useMemo(() => buildTreeModel(nodes, ROOT_ID), [nodes]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedNodeId || !listRef.current) return;
    const active = [...listRef.current.querySelectorAll<HTMLElement>("[data-tree-node-id]")].find(
      (element) => element.dataset.treeNodeId === selectedNodeId
    );
    active?.scrollIntoView({ block: "nearest" });
  }, [selectedNodeId, model]);

  const hasMoves = model.mainline.length > 0 || model.rootVariations.some((block) => block.rows.length);
  if (!hasMoves) {
    return <EmptyState compact title={emptyLabel} />;
  }

  const renderVariationBlocks = (blocks: TreeVariationBlock[] | undefined) =>
    blocks?.map((block, blockIndex) =>
      block.rows.map((row, rowIndex) => (
        <VariationRow
          key={`${row.node.id}-${blockIndex}-${rowIndex}`}
          row={row}
          selectedNodeId={selectedNodeId}
          reviews={reviews}
          commentaryByNodeId={commentaryByNodeId}
          showScores={showScores}
          showCommentaryState={showCommentaryState}
          onSelectNode={onSelectNode}
          onDeleteLine={onDeleteLine}
        />
      ))
    );

  return (
    <div ref={listRef} className={cn("scroll-area min-h-0 overflow-y-auto", className)} role="tree" aria-label={ariaLabel}>
      <div className="sticky top-0 z-10 mb-1 grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)] gap-1 border-b border-line-subtle bg-surface py-1.5 text-xs text-fg-muted">
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
              <div className="grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)] items-stretch gap-1" role="row" aria-level={1}>
                <span className="flex items-center justify-center font-mono text-2xs text-fg-subtle">{row.number}.</span>
                <TreeNodeCell
                  node={row.white}
                  selectedNodeId={selectedNodeId}
                  reviews={reviews}
                  commentaryByNodeId={commentaryByNodeId}
                  showScores={showScores}
                  showCommentaryState={showCommentaryState}
                  onSelectNode={onSelectNode}
                  onDeleteLine={onDeleteLine}
                />
                <TreeNodeCell
                  node={row.black}
                  selectedNodeId={selectedNodeId}
                  reviews={reviews}
                  commentaryByNodeId={commentaryByNodeId}
                  showScores={showScores}
                  showCommentaryState={showCommentaryState}
                  onSelectNode={onSelectNode}
                  onDeleteLine={onDeleteLine}
                />
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

type NodeCellProps = {
  node: MoveNode | undefined;
  selectedNodeId: string | null;
  reviews?: ReadonlyMap<string, MoveReview>;
  commentaryByNodeId?: ReadonlyMap<string, ReviewCommentary>;
  showScores: boolean;
  showCommentaryState: boolean;
  onSelectNode: (nodeId: string) => void;
  onDeleteLine?: (nodeId: string) => void;
};

function TreeNodeCell({
  node,
  selectedNodeId,
  reviews,
  commentaryByNodeId,
  showScores,
  showCommentaryState,
  onSelectNode,
  onDeleteLine
}: NodeCellProps) {
  if (!node) return <span aria-hidden="true" />;
  return (
    <TreeNodeButton
      node={node}
      selected={selectedNodeId === node.id}
      review={reviews?.get(node.id)}
      commentary={commentaryByNodeId?.get(node.id)}
      showScores={showScores}
      showCommentaryState={showCommentaryState}
      onSelect={() => onSelectNode(node.id)}
      onDelete={onDeleteLine ? () => onDeleteLine(node.id) : undefined}
    />
  );
}

function VariationRow({
  row,
  selectedNodeId,
  reviews,
  commentaryByNodeId,
  showScores,
  showCommentaryState,
  onSelectNode,
  onDeleteLine
}: {
  row: TreeVariationRow;
  selectedNodeId: string | null;
  reviews?: ReadonlyMap<string, MoveReview>;
  commentaryByNodeId?: ReadonlyMap<string, ReviewCommentary>;
  showScores: boolean;
  showCommentaryState: boolean;
  onSelectNode: (nodeId: string) => void;
  onDeleteLine?: (nodeId: string) => void;
}) {
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
      <span className="flex items-center justify-center font-mono text-2xs text-fg-subtle">{movePrefix(row.node)}</span>
      <div className="col-span-2 min-w-0">
        <TreeNodeButton
          node={row.node}
          selected={selectedNodeId === row.node.id}
          review={reviews?.get(row.node.id)}
          commentary={commentaryByNodeId?.get(row.node.id)}
          showScores={showScores}
          showCommentaryState={showCommentaryState}
          variation
          onSelect={() => onSelectNode(row.node.id)}
          onDelete={onDeleteLine ? () => onDeleteLine(row.node.id) : undefined}
        />
      </div>
    </div>
  );
}

function TreeNodeButton({
  node,
  selected,
  review,
  commentary,
  showScores,
  showCommentaryState,
  variation = false,
  onSelect,
  onDelete
}: {
  node: MoveNode;
  selected: boolean;
  review?: MoveReview;
  commentary?: ReviewCommentary;
  showScores: boolean;
  showCommentaryState: boolean;
  variation?: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  const title = review
    ? `${reviewLabel(review.classification)} · ${formatMoveEval(review)}`
    : variation
      ? `Variation: ${node.san ?? "move"}`
      : node.san ?? "Move";

  const showDelete = selected && Boolean(onDelete);

  return (
    <div className="group relative min-w-0">
      <button
        type="button"
        data-tree-node-id={node.id}
        aria-current={selected ? "step" : undefined}
        aria-selected={selected}
        className={cn(
          "flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50",
          selected
            ? "bg-accent-strong text-fg"
            : variation
              ? "text-fg-muted hover:bg-control hover:text-fg"
              : "text-fg-secondary hover:bg-control hover:text-fg",
          showDelete && "pr-8"
        )}
        title={title}
        onClick={onSelect}
      >
        <span className={cn("truncate font-mono text-sm", selected && "font-semibold")}>{node.san ?? "–"}</span>
        {variation ? <span className="shrink-0 text-fg-subtle">↳</span> : null}
        {review ? <QualityBadge variant="glyph" classification={review.classification} selected={selected} /> : null}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {showScores && review ? (
            <span className={cn("font-mono text-2xs", selected ? "text-fg/80" : "text-fg-subtle")}>
              {formatMoveEval(review)}
            </span>
          ) : null}
          {showCommentaryState && commentary ? (
            commentary.fallback ? (
              <CircleDashed aria-label="Fallback commentary" className={cn("size-3", selected ? "text-fg" : "text-warn")} />
            ) : (
              <Check aria-label="Commentary ready" className={cn("size-3", selected ? "text-fg" : "text-accent")} />
            )
          ) : null}
        </span>
      </button>
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
            onDelete?.();
          }}
        />
      ) : null}
    </div>
  );
}
