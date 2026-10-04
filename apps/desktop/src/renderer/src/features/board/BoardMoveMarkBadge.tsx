import { annotationGlyph } from "@chaturanga/shared/chess/move-assessment";
import type { Color } from "@chaturanga/shared/types/chess";
import { annotationTone } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { squareOffset, type BoardMoveMark } from "./move-mark";

/**
 * The review mark of the move just played, over a board (see boardMoveMark): a round badge with
 * the mark's glyph and colour in the top-right corner of the move's destination square. Placed in
 * percentages of the board, so it follows the orientation and any resize; it lets every click and
 * drag through to the board. Render it over the board's own box (a `relative` parent).
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
    <div className="pointer-events-none absolute inset-0 z-1">
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
          title={mark.label}
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
