import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Color, MoveNode } from "@chaturanga/shared/types/chess";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import { annotationTone } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { BoardThumbnail } from "../settings/board-thumbnail";
import { openBestLine, type BestLineCursor } from "./best-line-cursor";
import { FigureSan, keepFocusOnPress, LineRow, lineMoveClassName } from "./LineRow";
import {
  PREVIEW_BOARD_MIN,
  bestLineMoves,
  bestLineText,
  type BestLineMove
} from "./move-list-model";
import { usePreviewBoardSize } from "./usePreviewBoardSize";

/** How long the pointer rests on a suggested move before its position shows. */
const PREVIEW_DELAY_MS = 250;

/** Shows a position of a BEST line on the board (see the game store's showBestLine). */
export type BrowseLine = (cursor: BestLineCursor) => void;

/**
 * The BEST row under a marked error: `BEST 12… ♘c5 13. ♘d2 a4 14. f4`, a line row (see LineRow)
 * ruled in the mark's colour, the best move itself in that colour. Resting on a move of the line
 * shows its position below (the only moves that preview: the game's own moves are on the board
 * already). Clicking one shows its position on the board and makes it the current move here,
 * without adding it to the game; ←/→ then step along the line.
 */
export const BestLineRow = memo(function BestLineRow({
  id,
  node,
  review,
  gridClassName,
  orientation,
  currentIndex,
  onBrowse
}: {
  id: string;
  node: MoveNode;
  review: MoveReview;
  /** The list's column template, so the row starts at the move column. */
  gridClassName: string;
  orientation: Color;
  /** The move of this line on the board (null: the board isn't on this line). */
  currentIndex: number | null;
  onBrowse?: BrowseLine;
}) {
  const moves = useMemo(() => bestLineMoves(review), [review]);
  const annotation = review.assessment?.annotation ?? null;
  const tone = annotation ? annotationTone[annotation] : null;
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const timer = useRef<number | null>(null);
  const cancelTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancelTimer, []);

  const showSoon = (index: number) => {
    cancelTimer();
    // Once a preview shows, moving along the line follows at once.
    if (previewIndex !== null) {
      setPreviewIndex(index);
      return;
    }
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setPreviewIndex(index);
    }, PREVIEW_DELAY_MS);
  };
  const hide = () => {
    cancelTimer();
    setPreviewIndex(null);
  };

  if (!moves.length) return null;
  const lineLabel = bestLineText(moves);
  const previewed = previewIndex === null ? null : (moves[previewIndex] ?? null);
  const anchorNodeId = node.parentId;
  const browse =
    onBrowse && anchorNodeId
      ? (index: number) => {
          const cursor = openBestLine(node.id, anchorNodeId, moves, index);
          if (cursor) onBrowse(cursor);
        }
      : undefined;

  const entries = moves.map((move, index) => ({
    key: `${index}-${move.uci}`,
    number: move.number,
    move: (
      <LineMove
        move={move}
        best={index === 0}
        bestClassName={tone?.text}
        previewed={previewIndex === index}
        current={currentIndex === index}
        label={`Show ${bestLineText(moves.slice(0, index + 1))} on the board`}
        onPreview={() => showSoon(index)}
        onFocusPreview={() => {
          cancelTimer();
          setPreviewIndex(index);
        }}
        onActivate={browse ? () => browse(index) : undefined}
      />
    )
  }));

  return (
    <LineRow
      id={id}
      ariaLabel={`Best line: ${lineLabel}`}
      gridClassName={gridClassName}
      ruleColor={tone?.fill ?? "currentColor"}
      label="Best"
      entries={entries}
      currentKey={currentIndex === null ? null : (entries[currentIndex]?.key ?? null)}
      // Leaving the line (pointer or focus) ends its move preview.
      onPointerLeave={hide}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) hide();
      }}
      // Its preview floats under it (over the rows below, which it never moves).
      after={
        previewed ? (
          <LinePreview
            move={previewed}
            moveNumber={previewNumber(moves, previewIndex ?? 0)}
            orientation={orientation}
          />
        ) : null
      }
    />
  );
});

/** The number before a line's move in the preview's name: `13.`, or `13…` for Black's. */
function previewNumber(moves: readonly BestLineMove[], index: number): string {
  const own = moves[index]?.number;
  if (own) return own;
  // Black's move after White's: the number White's move carries, as Black's.
  const white = moves[index - 1]?.number;
  return white ? white.replace(".", "…") : "";
}

function LineMove({
  move,
  best,
  bestClassName,
  previewed,
  current,
  label,
  onPreview,
  onFocusPreview,
  onActivate
}: {
  move: BestLineMove;
  best: boolean;
  bestClassName?: string;
  previewed: boolean;
  /** The move on the board (the line is being browsed). */
  current: boolean;
  label: string;
  onPreview: () => void;
  onFocusPreview: () => void;
  onActivate?: () => void;
}) {
  const className = lineMoveClassName({
    current,
    toneClassName: best ? bestClassName : undefined,
    previewed
  });
  if (!onActivate) {
    return (
      <span
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a line move that can't be played is still reachable by keyboard, for its preview
        tabIndex={0}
        aria-label={move.san}
        className={className}
        onPointerEnter={onPreview}
        onFocus={onFocusPreview}
      >
        <FigureSan san={move.san} />
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={current ? "step" : undefined}
      data-best-line-move={move.san}
      className={cn(className, "cursor-pointer")}
      onMouseDown={keepFocusOnPress}
      onPointerEnter={onPreview}
      onFocus={onFocusPreview}
      onClick={onActivate}
    >
      <FigureSan san={move.san} />
    </button>
  );
}

/**
 * The position after a suggested move: just a board, the panel's width, in the board's own theme
 * and pieces, the move tinted (named for assistive tech only). It lets the pointer through, so it
 * never takes a click meant for the list.
 */
function LinePreview({
  move,
  moveNumber,
  orientation
}: {
  move: BestLineMove;
  moveNumber: string;
  orientation: Color;
}) {
  // Sized to the room under the line and to the main board (see previewBoardSize), left-aligned.
  const slotRef = useRef<HTMLDivElement>(null);
  const size = usePreviewBoardSize(slotRef);
  return (
    <div
      ref={slotRef}
      className="pointer-events-none absolute inset-x-0 top-full z-20 -mt-1 min-w-0"
    >
      <div
        role="img"
        aria-label={`Position after ${moveNumber} ${move.san}`}
        data-line-preview=""
        className="w-fit animate-fade-in rounded-md shadow-[0_10px_28px_rgb(0_0_0/0.45)]"
        style={{
          width: size ?? PREVIEW_BOARD_MIN,
          visibility: size === null ? "hidden" : undefined
        }}
      >
        <BoardThumbnail
          fen={move.fenAfter}
          orientation={orientation}
          lastMove={move.uci}
          rounded="md"
        />
      </div>
    </div>
  );
}
