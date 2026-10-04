import type { MoveAnnotation } from "@chaturanga/shared/types/engine";
import { annotationGlyph, annotationLabel } from "@chaturanga/shared/chess/move-assessment";
import { BookOpen } from "lucide-react";
import { annotationTone } from "@/lib/ui";
import { cn } from "@/lib/utils";

/**
 * A move's review mark, on the shared `annotationTone` colours. Renders nothing for an unmarked
 * move (`annotation` null): ordinary moves carry no badge.
 * - `variant="label"` (default): pill with the mark's name ("Great", "Blunder") — review headers.
 * - `variant="glyph"`: tiny inline tag with the glyph ("!", "?!") — move lists. Its accessible
 *   name is the mark's name, so a screen reader never reads "question exclamation".
 * `selected` renders the glyph on a selected (accent-filled) row. Book's glyph is an open book icon.
 */
function AnnotationBadge({
  annotation,
  variant = "label",
  selected = false,
  className
}: {
  annotation: MoveAnnotation | null;
  variant?: "label" | "glyph";
  selected?: boolean;
  className?: string;
}) {
  if (!annotation) return null;
  const label = annotationLabel(annotation);
  const glyph =
    annotation === "book" ? (
      <BookOpen aria-hidden className="inline size-3 align-[-2px]" strokeWidth={2.25} />
    ) : (
      annotationGlyph(annotation)
    );
  if (variant === "glyph") {
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        data-annotation={annotation}
        className={cn(
          "min-w-0 shrink-0 truncate rounded-md px-1 font-mono text-2xs font-semibold leading-4",
          selected ? "bg-fg/15 text-fg" : annotationTone[annotation].badge,
          className
        )}
      >
        {glyph}
      </span>
    );
  }
  return (
    <span
      data-annotation={annotation}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 text-2xs font-medium",
        annotationTone[annotation].badge,
        className
      )}
    >
      <span aria-hidden className="font-mono font-semibold">
        {glyph}
      </span>
      {label}
    </span>
  );
}

export { AnnotationBadge };
