import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Color, MoveNode } from "@chaturanga/shared/types/chess";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import { annotationTone } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { Figurine } from "../board/Figurine";
import { formatScore } from "../game-review/review-score";
import type { MoveNavigationTarget } from "../game-review/commentary-moves";
import { BoardThumbnail } from "../settings/board-thumbnail";
import {
  PREVIEW_BOARD_MIN,
  previewBoardSize,
  bareSan,
  bestLineMoves,
  bestLineText,
  sanPiece,
  type BestLineMove
} from "./move-list-model";

/** The preview card's padding and border around its board (p-2 and 1px, each side). */
const PREVIEW_CHROME = 18;

/** How long the pointer rests on a suggested move before its position shows. */
const PREVIEW_DELAY_MS = 250;

/** Plays a line's moves on the board as a variation; `markedNodeId` is the error it answers. */
export type PlayLine = (target: MoveNavigationTarget, markedNodeId: string) => void;

/** A move of a line drawn with the board's piece, as the move list draws moves (`♘d2`, `♙a4`). */
function FigureSan({ san }: { san: string }) {
  return (
    <>
      <Figurine role={sanPiece(san)} />
      {bareSan(san)}
    </>
  );
}

/**
 * The BEST row under a marked error: `BEST 12… ♘c5 13. ♘d2 a4 14. f4`, from the move column to the
 * end, ruled on the left in the mark's colour, the best move itself in that colour. Resting on a
 * move of the line shows its position below (the only moves that preview: the game's own moves are
 * on the board already); clicking one plays the line up to it on the board as a variation.
 */
export const BestLineRow = memo(function BestLineRow({
  id,
  node,
  review,
  gridClassName,
  orientation,
  onPlayLine
}: {
  id: string;
  node: MoveNode;
  review: MoveReview;
  /** The list's column template, so the row starts at the move column. */
  gridClassName: string;
  orientation: Color;
  onPlayLine?: PlayLine;
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
  const sans = moves.map((move) => move.san);
  const lineLabel = bestLineText(moves);
  const previewed = previewIndex === null ? null : (moves[previewIndex] ?? null);
  const play = onPlayLine && node.parentId ? onPlayLine : undefined;
  const startNodeId = node.parentId;

  return (
    <div
      id={id}
      className={cn("grid", gridClassName)}
      role="group"
      aria-label={`Best line: ${lineLabel}`}
    >
      {/* Leaving the line (pointer or focus) ends its move preview. */}
      <div
        className="col-[2/-1] mb-1.5 rounded-r-md border-l-2 bg-fg/[0.03] px-2.5 py-1.5 text-[0.8125rem] leading-[1.75]"
        style={{ borderLeftColor: tone?.fill }}
        onPointerLeave={hide}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (!(next instanceof Node) || !event.currentTarget.contains(next)) hide();
        }}
      >
        <span className="mr-0.5 font-mono text-[0.6875rem] font-medium tracking-[0.08em] text-fg-subtle uppercase">
          Best
        </span>
        {moves.map((move, index) => (
          <Fragment key={`${index}-${move.uci}`}>
            {move.number ? (
              <span
                className={cn(
                  "mr-[3px] font-mono text-xs text-fg-subtle tabular-nums",
                  index === 0 ? "ml-2.5" : "ml-1.5"
                )}
              >
                {move.number}
              </span>
            ) : null}
            <LineMove
              move={move}
              best={index === 0}
              bestClassName={tone?.text}
              previewed={previewIndex === index}
              label={`Play the best line to ${bestLineText(moves.slice(0, index + 1))}`}
              onPreview={() => showSoon(index)}
              onFocusPreview={() => {
                cancelTimer();
                setPreviewIndex(index);
              }}
              onActivate={
                play && startNodeId
                  ? () => play({ startNodeId, moves: sans.slice(0, index + 1) }, node.id)
                  : undefined
              }
            />
          </Fragment>
        ))}
      </div>
      {previewed ? (
        <LinePreview
          move={previewed}
          moveNumber={previewNumber(moves, previewIndex ?? 0)}
          score={formatScore(review.bestEvalAfter ?? review.evalBefore)}
          orientation={orientation}
        />
      ) : null}
    </div>
  );
});

/** The number before a line's move in the preview's caption: `13.`, or `13…` for Black's. */
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
  label,
  onPreview,
  onFocusPreview,
  onActivate
}: {
  move: BestLineMove;
  best: boolean;
  bestClassName?: string;
  previewed: boolean;
  label: string;
  onPreview: () => void;
  onFocusPreview: () => void;
  onActivate?: () => void;
}) {
  const className = cn(
    "rounded-[4px] px-1 font-semibold whitespace-nowrap outline-none",
    "transition-colors duration-micro ease-standard focus-visible:ring-2 focus-visible:ring-accent/50",
    best ? bestClassName : "text-fg-secondary",
    previewed ? "bg-fg/10" : "hover:bg-fg/10"
  );
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
      data-best-line-move={move.san}
      className={cn(className, "cursor-pointer")}
      onPointerEnter={onPreview}
      onFocus={onFocusPreview}
      onClick={onActivate}
    >
      <FigureSan san={move.san} />
    </button>
  );
}

/**
 * The position after a suggested move: a board the panel's width in the board's own theme and
 * pieces, the move tinted, captioned `13. ♘d2 … −0.1` (the line's score). It lets the pointer
 * through, so it never takes a click meant for the list.
 */
function LinePreview({
  move,
  moveNumber,
  score,
  orientation
}: {
  move: BestLineMove;
  moveNumber: string;
  score: string;
  orientation: Color;
}) {
  // Sized to the room under the line and to the main board (see previewBoardSize), left-aligned.
  const slotRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<number | null>(null);
  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;
    const measure = () => {
      const board = document.querySelector('section[aria-label="Board"] cg-board');
      const mainBoard = board ? board.getBoundingClientRect().width : null;
      // The card's padding and border (p-2, 1px) sit around the board.
      setSize(previewBoardSize(slot.clientWidth - PREVIEW_CHROME, mainBoard));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={slotRef} className="pointer-events-none col-[2/-1] mb-2 min-w-0">
      <div
        role="img"
        aria-label={`Position after ${moveNumber} ${move.san}`}
        data-line-preview=""
        className="grid w-fit animate-fade-in gap-1.5 rounded-lg border border-line bg-surface-raised p-2 shadow-[0_10px_28px_rgb(0_0_0/0.45)]"
        style={size === null ? { visibility: "hidden" } : undefined}
      >
        <div style={{ width: size ?? PREVIEW_BOARD_MIN }}>
          <BoardThumbnail
            fen={move.fenAfter}
            orientation={orientation}
            lastMove={move.uci}
            rounded="md"
          />
        </div>
        <p className="flex items-center gap-1.5 text-[0.8125rem] leading-none font-medium text-fg-secondary">
          <span className="font-mono text-xs text-fg-subtle tabular-nums">{moveNumber}</span>
          <span>
            <FigureSan san={move.san} />
          </span>
          <span className="ml-auto font-mono text-xs text-fg-subtle tabular-nums">{score}</span>
        </p>
      </div>
    </div>
  );
}
