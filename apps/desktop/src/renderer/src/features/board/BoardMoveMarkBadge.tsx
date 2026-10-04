import { annotationGlyph } from "@chaturanga/shared/chess/move-assessment";
import type { Color } from "@chaturanga/shared/types/chess";
import { annotationTone } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { squareOffset, type BoardMoveMark } from "./move-mark";

/**
 * The review mark of the move just played, over a board (see boardMoveMark): a round badge with
 * the mark's glyph and colour in the top-right corner of the move's destination square. Placed in
 * percentages of the board, so it follows the orientation and any resize; it lets every click and
 * drag through to the board. Render it over the board's own box: a `relative isolate` parent
 * holding the Chessground element and the badge.
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
  if (!mark) return null;
  const { left, top } = squareOffset(mark.square, orientation);
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* One square's box, a size container: the badge and its glyph scale with the square. */}
      <div
        className="absolute size-[12.5%] [container-type:size]"
        style={{ left: `${left}%`, top: `${top}%` }}
      >
        <span
          // A fresh badge for each move, so stepping to another marked move shows it arrive.
          key={mark.nodeId}
          role="img"
          aria-label={mark.label}
          data-annotation={mark.annotation}
          data-square={mark.square}
          className={cn(
            "absolute top-[4%] right-[4%] grid size-[38%] origin-center animate-pop-in place-items-center rounded-full font-mono font-bold leading-none tracking-tighter text-canvas ring-1 ring-canvas/50",
            "text-[length:17cqw]",
            annotationTone[mark.annotation].dot
          )}
        >
          {annotationGlyph(mark.annotation)}
        </span>
      </div>
    </div>
  );
}
