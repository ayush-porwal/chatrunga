import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { ArrowUpToLine, Check, Trash2 } from "lucide-react";
import { annotationLabel } from "@chaturanga/shared/chess/move-assessment";
import { formatMoveEval } from "../game-review/review-score";
import type { GameOpening, MoveReview, ReviewCommentary } from "@chaturanga/shared/types/engine";
import type { Color, MoveNode } from "@chaturanga/shared/types/chess";
import {
  buildTreeModel,
  movePrefix,
  type TreeVariationBlock,
  type TreeVariationRow
} from "./move-tree-model";
import {
  bareSan,
  hasBestLine,
  lineUnfolded,
  mainlineItems,
  sanPiece,
  setAllLineFolds,
  toggleLineFold,
  type LineFolds
} from "./move-list-model";
import { loadShowAllLines, saveShowAllLines } from "./move-list-prefs";
import { BestLineRow, type BrowseLine } from "./BestLineRow";
import type { BestLineCursor } from "./best-line-cursor";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { annotationTone } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { Figurine } from "../board/Figurine";
import { MoveMarkDisc } from "../board/MoveMarkDisc";
import { useBoardAppearance } from "../board/useBoardAppearance";
import { isRapidNavigation, usePrefersReducedMotion } from "../board/board-motion";

const ROOT_ID = "root";
/** Deeper variations stop indenting (the depth is still in the row's title). */
const MAX_VISUAL_DEPTH = 8;

/** Number · White's move · Black's move: two equal blocks, each holding its move's eval. */
const ROW_GRID = "grid-cols-[1.625rem_minmax(0,1fr)_minmax(0,1fr)]";
/** A variation's row: its number (`12…`) and the move. */
const VARIATION_ROW_GRID = "grid-cols-[2rem_minmax(0,1fr)]";

type TreeViewProps = {
  nodes: readonly MoveNode[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  /** Review data by node: each move's mark and eval, and the BEST line under a marked error. */
  reviews?: ReadonlyMap<string, MoveReview>;
  commentaryByNodeId?: ReadonlyMap<string, ReviewCommentary>;
  showCommentaryState?: boolean;
  onDeleteLine?: (nodeId: string) => void;
  /** Offered on a selected move inside a variation: moves that variation up (see its owner). */
  onPromoteVariation?: (nodeId: string) => void;
  /** The game's opening: its row follows the last book move. */
  opening?: GameOpening | null;
  /** Shows a BEST line's move on the board (not added to the game). Unset, the lines only show. */
  onBrowseLine?: BrowseLine;
  /** The BEST line on the board, if any: its move is the current one, not the game's. */
  activeBestLine?: BestLineCursor | null;
  /** The way the BEST lines' preview boards face (the board's orientation). */
  orientation?: Color;
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

/**
 * The move list, the one every board page lists its moves with (Game review, Analyze, the game
 * board, Study): two moves to a row, each with its mark's disc, its piece in the board's own set
 * and its SAN (coloured by its mark), and its eval when there is review data. The opening's row
 * follows the last book move; a marked error's BEST line unfolds under it from its disc (or all of
 * them from the header). Variations nest under the move they branch from.
 */
export function TreeView({
  nodes,
  selectedNodeId,
  onSelectNode,
  reviews,
  commentaryByNodeId,
  showCommentaryState = false,
  onDeleteLine,
  onPromoteVariation,
  opening = null,
  onBrowseLine,
  activeBestLine = null,
  orientation = "white",
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
  const { pieceClassName } = useBoardAppearance();
  const listId = useId();
  const showScores = Boolean(reviews?.size);

  const [folds, setFolds] = useState<LineFolds>(() => setAllLineFolds(loadShowAllLines()));
  const toggleFold = useCallback(
    (nodeId: string) => setFolds((current) => toggleLineFold(current, nodeId)),
    []
  );
  const setAllFolds = (showAll: boolean) => {
    saveShowAllLines(showAll);
    setFolds(setAllLineFolds(showAll));
  };
  const hasLines = useMemo(
    () => (reviews ? [...reviews.values()].some((review) => hasBestLine(review)) : false),
    [reviews]
  );
  // The last book move's node: the opening's row follows it.
  const bookEndNodeId = useMemo(() => {
    if (!opening || !reviews) return null;
    for (const review of reviews.values())
      if (review.ply === opening.bookEndPly) return review.nodeId;
    return null;
  }, [opening, reviews]);
  const bestLineId = (nodeId: string) => `${listId}-best-${nodeId}`;
  const showsBestLine = (node: MoveNode) =>
    lineUnfolded(folds, node.id) && hasBestLine(reviews?.get(node.id));

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

  const bestLine = (node: MoveNode) => {
    const review = reviews?.get(node.id);
    if (!hasBestLine(review)) return null;
    return (
      <BestLineRow
        key={`best-${node.id}`}
        id={bestLineId(node.id)}
        node={node}
        review={review}
        gridClassName={ROW_GRID}
        orientation={orientation}
        currentIndex={activeBestLine?.markedNodeId === node.id ? activeBestLine.index : null}
        onBrowse={onBrowseLine}
      />
    );
  };

  const cellProps = (node: MoveNode) => {
    const review = reviews?.get(node.id);
    const foldable = hasBestLine(review);
    return {
      node,
      // While a BEST line is on the board, its move is the current one, not the error's.
      selected: selectedNodeId === node.id && !activeBestLine,
      review,
      commentary: commentaryByNodeId?.get(node.id),
      showScores,
      showCommentaryState,
      onSelectNode,
      onDeleteLine,
      onPromoteVariation,
      lineUnfolded: foldable ? lineUnfolded(folds, node.id) : undefined,
      lineId: foldable ? bestLineId(node.id) : undefined,
      onToggleLine: foldable ? toggleFold : undefined
    };
  };

  const renderVariationBlocks = (blocks: TreeVariationBlock[] | undefined) =>
    blocks?.map((block, blockIndex) =>
      block.rows.map((row, rowIndex) => {
        const key = `${row.node.id}-${blockIndex}-${rowIndex}`;
        const hiddenMoves = collapsedRows?.get(row.node.id);
        if (hiddenMoves !== undefined) {
          return (
            <CollapsedRow key={key} row={row} hiddenMoves={hiddenMoves} onExpand={onExpandRow} />
          );
        }
        return (
          <Fragment key={key}>
            <VariationRow row={row} {...cellProps(row.node)} />
            {showsBestLine(row.node) ? bestLine(row.node) : null}
          </Fragment>
        );
      })
    );

  const cell = (node: MoveNode | undefined) =>
    node ? <MoveCell {...cellProps(node)} /> : <span aria-hidden="true" />;

  const items = mainlineItems(model, { bookEndNodeId, showsBestLine });

  return (
    <div
      ref={listRef}
      className={cn("scroll-area min-h-0 overflow-y-auto", className)}
      role="tree"
      aria-label={ariaLabel}
    >
      <div
        ref={headerRef}
        className={cn(
          "sticky top-0 z-10 mb-1 grid items-center gap-x-1 border-b border-line-subtle bg-surface py-1.5 text-xs text-fg-muted",
          ROW_GRID
        )}
      >
        <span className="text-center">#</span>
        <span className="px-1.5">White</span>
        <span className="flex min-w-0 items-center justify-between gap-2 pl-1.5">
          <span className="truncate">Black</span>
          {hasLines ? (
            <button
              type="button"
              aria-pressed={folds.showAll}
              className="shrink-0 cursor-pointer rounded-sm text-2xs whitespace-nowrap text-fg-subtle outline-none transition-colors duration-micro ease-standard hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50"
              onClick={() => setAllFolds(!folds.showAll)}
            >
              {folds.showAll ? "Hide all lines" : "Show all lines"}
            </button>
          ) : null}
        </span>
      </div>
      {/* The board's piece set, so every move's piece is the board's own. */}
      <div
        className={cn("cg-wrap grid gap-0.5", pieceClassName)}
        // Unlayered `.cg-wrap` rules (display: block, board.css inline-size containment) would lay this out.
        style={{ display: "grid", containerType: "normal" }}
      >
        {selectedNodeId === ROOT_ID ? (
          <button
            type="button"
            data-tree-node-id={ROOT_ID}
            aria-current="step"
            aria-selected="true"
            role="treeitem"
            aria-level={1}
            className="flex h-8 items-center rounded-md bg-accent-soft px-2 text-left text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            onClick={() => onSelectNode(ROOT_ID)}
          >
            Starting position
          </button>
        ) : null}
        {renderVariationBlocks(model.rootVariations)}
        {items.map((item) => {
          switch (item.kind) {
            case "moves":
              return (
                <div
                  key={`main-${item.number}-${item.white?.id ?? "empty"}-${item.black?.id ?? "empty"}`}
                  className={cn("grid min-h-8 items-center gap-x-1", ROW_GRID)}
                  role="row"
                  aria-level={1}
                >
                  <span className="font-mono text-xs text-fg-subtle tabular-nums">
                    {item.number}
                  </span>
                  {cell(item.white)}
                  {cell(item.black)}
                </div>
              );
            case "opening":
              return opening ? (
                <OpeningRow
                  key={`opening-${item.afterNodeId}`}
                  opening={opening}
                  gridClassName={ROW_GRID}
                />
              ) : null;
            case "best":
              return bestLine(item.node);
            case "variations":
              return (
                <Fragment key={`variations-${item.parentId}`}>
                  {renderVariationBlocks(item.blocks)}
                </Fragment>
              );
          }
        })}
      </div>
    </div>
  );
}

/** Room kept between the current move and the list's edges when scrolling it into view. */
const SCROLL_MARGIN = 8;

/** "📖 A28 English Opening: Four Knights System … book ends", after the last book move. */
function OpeningRow({ opening, gridClassName }: { opening: GameOpening; gridClassName: string }) {
  return (
    <div className={cn("grid", gridClassName)}>
      <p
        className="col-[2/-1] mb-1.5 flex min-w-0 items-center gap-2 rounded-md bg-mark-book/10 px-2.5 py-1.5 text-[0.8125rem] leading-[1.3] text-fg-secondary"
        aria-label={`${opening.eco} ${opening.name}: book ends`}
      >
        <MoveMarkDisc annotation="book" decorative />
        <span className="min-w-0 truncate" title={`${opening.eco} ${opening.name}`}>
          <b className="mr-1 font-mono text-xs font-semibold text-mark-book-text">{opening.eco}</b>
          {opening.name}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[0.6875rem] whitespace-nowrap text-fg-subtle">
          book ends
        </span>
      </p>
    </div>
  );
}

type MoveCellProps = {
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
  /** A marked error with a BEST line: whether it is unfolded (undefined: the move has none). */
  lineUnfolded?: boolean;
  /** The BEST row's element id, which the disc unfolds. */
  lineId?: string;
  onToggleLine?: (nodeId: string) => void;
};

/** Memoised: stepping through a game re-renders only the two rows whose selection changed. */
const VariationRow = memo(function VariationRow({
  row,
  ...cell
}: Omit<MoveCellProps, "variation"> & { row: TreeVariationRow }) {
  const visualDepth = Math.min(row.depth, MAX_VISUAL_DEPTH);
  const hiddenDepth = Math.max(0, row.depth - MAX_VISUAL_DEPTH);
  return (
    <div
      className={cn(
        "grid min-h-8 items-center gap-x-1 border-l border-line-strong",
        VARIATION_ROW_GRID
      )}
      style={{ paddingInlineStart: `${visualDepth * 12 + 4}px` }}
      data-tree-depth={row.depth}
      data-branch-start={row.branchStart ? "true" : undefined}
      role="treeitem"
      aria-level={row.depth + 1}
      title={hiddenDepth ? `Variation depth ${row.depth}` : undefined}
    >
      <span className="font-mono text-2xs text-fg-subtle tabular-nums">{movePrefix(row.node)}</span>
      <MoveCell {...cell} variation />
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

/**
 * One move: a fixed slot for its mark's disc (a marked error's disc folds its BEST line), a fixed
 * slot for its piece in the board's set (a pawn for pawn moves, the king for castling), then the
 * SAN without its piece letter, coloured by the mark. Its eval follows in its own column.
 */
const MoveCell = memo(function MoveCell({
  node,
  selected,
  review,
  commentary,
  showScores,
  showCommentaryState,
  variation = false,
  onSelectNode,
  onDeleteLine,
  onPromoteVariation,
  lineUnfolded,
  lineId,
  onToggleLine
}: MoveCellProps) {
  const annotation = review?.assessment?.annotation ?? null;
  const san = node.san ?? "–";
  const title = review
    ? `${annotation ? `${annotationLabel(annotation)} · ` : ""}${formatMoveEval(review)}`
    : variation
      ? `Variation: ${node.san ?? "move"}`
      : (node.san ?? "Move");

  const showDelete = selected && Boolean(onDeleteLine);
  const showPromote = selected && variation && Boolean(onPromoteVariation);
  const foldable = lineUnfolded !== undefined && Boolean(onToggleLine);

  return (
    <div
      className={cn(
        "group relative min-w-0 rounded-[0.3125rem] transition-colors duration-micro ease-standard",
        selected ? "bg-accent-soft" : "hover:bg-control"
      )}
      data-move-cell={node.id}
    >
      <button
        type="button"
        data-tree-node-id={node.id}
        aria-current={selected ? "step" : undefined}
        // Named by its SAN (the piece is drawn, not written); the mark has its own name beside it.
        aria-label={san}
        className={cn(
          "flex h-8 w-full min-w-0 items-center gap-[0.4375rem] rounded-[0.3125rem] px-1.5 text-left text-[0.90625rem] font-medium tracking-[0.01em] outline-none",
          "focus-visible:ring-2 focus-visible:ring-accent/50",
          annotation
            ? annotationTone[annotation].text
            : selected
              ? "text-fg"
              : variation
                ? "text-fg-muted"
                : "text-fg-secondary",
          selected && "font-semibold"
        )}
        title={title}
        onClick={() => onSelectNode(node.id)}
      >
        {/* The mark's slot: its disc sits over it (beside the button, so it can be its own control). */}
        <span aria-hidden className="w-[1.125rem] shrink-0" />
        <span className="flex min-w-0 items-center">
          {node.san ? (
            <span className="inline-flex w-[1.3em] shrink-0 justify-center">
              <Figurine role={sanPiece(node.san)} className="m-0" />
            </span>
          ) : null}
          <span className="truncate">{node.san ? bareSan(node.san) : san}</span>
        </span>
        {variation ? <span className="shrink-0 text-fg-subtle">↳</span> : null}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {showCommentaryState && commentary ? (
            <Check
              aria-label="Commentary ready"
              className={cn("size-3 shrink-0", selected ? "text-fg" : "text-accent")}
            />
          ) : null}
          {/* Its eval, right-aligned inside the move's block (a fixed width keeps rows aligned). */}
          {showScores ? (
            <span className="w-[2.5rem] text-right font-mono text-[0.71875rem] font-normal tracking-normal text-fg-subtle tabular-nums">
              {review ? formatMoveEval(review) : null}
            </span>
          ) : null}
        </span>
      </button>
      {annotation ? (
        <span className="pointer-events-none absolute top-1/2 left-1.5 flex -translate-y-1/2">
          {foldable ? (
            <button
              type="button"
              aria-expanded={lineUnfolded}
              aria-controls={lineUnfolded ? lineId : undefined}
              aria-label={`${annotationLabel(annotation)}: ${lineUnfolded ? "hide" : "show"} the best line`}
              title={`${annotationLabel(annotation)} · ${lineUnfolded ? "hide" : "show"} the best line`}
              className="pointer-events-auto flex cursor-pointer rounded-full outline-none transition-transform duration-micro ease-standard hover:scale-110 focus-visible:ring-2 focus-visible:ring-accent/50"
              onClick={() => onToggleLine?.(node.id)}
            >
              <MoveMarkDisc annotation={annotation} decorative />
            </button>
          ) : (
            <MoveMarkDisc annotation={annotation} />
          )}
        </span>
      ) : null}
      {showPromote ? (
        <IconButton
          label={`Promote the variation with ${node.san ?? "the selected move"}`}
          icon={<ArrowUpToLine />}
          variant="ghost"
          size="icon-xs"
          tooltipSide="left"
          // Over the eval while the move is hovered, on the selected block's own colour.
          className={cn(
            "absolute top-1/2 -translate-y-1/2 bg-accent-soft opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
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
          className="absolute right-0.5 top-1/2 -translate-y-1/2 bg-accent-soft opacity-0 hover:bg-danger-soft group-hover:opacity-100 focus-visible:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            onDeleteLine?.(node.id);
          }}
        />
      ) : null}
    </div>
  );
});
