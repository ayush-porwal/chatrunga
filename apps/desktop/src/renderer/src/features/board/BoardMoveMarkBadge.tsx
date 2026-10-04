import { useId } from "react";
import type { Color } from "@chaturanga/shared/types/chess";
import { annotationTone } from "@/lib/ui";
import { MoveMarkGlyph } from "./MoveMarkGlyph";
import { squareOffset, type BoardMoveMark } from "./move-mark";

/**
 * The review mark of the move just played, over a board (see boardMoveMark), drawn as Lichess
 * draws its move glyphs: a filled circle 40% of the square across, its box at (71%, −12%) of the
 * destination square so it overhangs the square's top-right corner, with a soft drop shadow and
 * the mark's glyph in white (MoveMarkGlyph). Everything is in the circle's own 0–100 units, so it
 * scales with the square; the square is placed in percentages of the board, so it follows the
 * orientation and any resize. It lets every click and drag through to the board. Render it over
 * the board's own box: a `relative isolate` parent holding the Chessground element and the badge.
 * Only the Chessground element clips (to the frame's rounded corners, board.css); neither that
 * parent nor the stage's frame does, so on an edge square the badge overhangs the board's edge.
 *
 * Chessground's elements set no stacking context of their own, so its pieces (z-index 2), arrows
 * (2, custom shapes 9), sliding pieces (8) and the dragged piece (11) are stacked in the nearest
 * one, with the badge. The parent's `isolate` makes that the board itself, so none of them reach
 * past the board; within it the badge sits at 10 in Chessground's own scale: over the pieces,
 * standing or sliding in, and over the translucent arrows (the played move's ends on its square),
 * but under the piece being dragged, which stays in the hand on top of everything.
 */
export function BoardMoveMarkBadge({
  mark,
  orientation
}: {
  mark: BoardMoveMark | null;
  orientation: Color;
}) {
  const shadowId = useId();
  if (!mark) return null;
  const { left, top } = squareOffset(mark.square, orientation);
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* One square's box: the badge is placed and sized in its percentages. */}
      <div className="absolute size-[12.5%]" style={{ left: `${left}%`, top: `${top}%` }}>
        <svg
          // A fresh badge for each move, so stepping to another marked move shows it arrive.
          key={mark.nodeId}
          role="img"
          aria-label={mark.label}
          data-annotation={mark.annotation}
          data-square={mark.square}
          viewBox="0 0 100 100"
          className="absolute top-[-12%] left-[71%] size-[40%] origin-center animate-pop-in overflow-visible text-mark-fg"
        >
          <defs>
            {/* Room for the shadow below and right of the circle (offset 4, 7; blur 5). */}
            <filter id={shadowId} x="-20%" y="-20%" width="150%" height="160%">
              <feDropShadow dx="4" dy="7" stdDeviation="5" floodOpacity="0.5" />
            </filter>
          </defs>
          <circle
            cx="50"
            cy="50"
            r="50"
            fill={annotationTone[mark.annotation].fill}
            filter={`url(#${shadowId})`}
          />
          <g fill="currentColor">
            <MoveMarkGlyph annotation={mark.annotation} />
          </g>
        </svg>
      </div>
    </div>
  );
}
