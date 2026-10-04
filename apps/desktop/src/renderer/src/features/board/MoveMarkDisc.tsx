import type { MoveAnnotation } from "@chaturanga/shared/types/engine";
import { annotationLabel } from "@chaturanga/shared/chess/move-assessment";
import { annotationTone } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { MoveMarkGlyph } from "./MoveMarkGlyph";

/**
 * A move's mark as a small disc beside text (the move list, the summary): the board badge's
 * filled circle and white glyph (MoveMarkGlyph), 18px across with a soft shadow. Named by the
 * mark ("Blunder") unless `decorative`, where the text next to it already says it.
 */
export function MoveMarkDisc({
  annotation,
  decorative = false,
  className
}: {
  annotation: MoveAnnotation;
  decorative?: boolean;
  className?: string;
}) {
  const label = annotationLabel(annotation);
  return (
    <svg
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      data-annotation={annotation}
      viewBox="0 0 100 100"
      className={cn(
        "size-[1.125rem] shrink-0 overflow-visible rounded-full text-mark-fg shadow-[0_1px_2px_rgb(0_0_0/0.45)]",
        className
      )}
    >
      {decorative ? null : <title>{label}</title>}
      <circle cx="50" cy="50" r="50" fill={annotationTone[annotation].fill} />
      <g fill="currentColor">
        <MoveMarkGlyph annotation={annotation} />
      </g>
    </svg>
  );
}
