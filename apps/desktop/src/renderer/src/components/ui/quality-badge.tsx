import type { MoveClassification } from "@chaturanga/shared/types/engine";
import { reviewLabel } from "@chaturanga/shared/chess/review";
import { qualityTone } from "@/lib/ui";
import { cn } from "@/lib/utils";

/** Annotation glyph per classification ("" = no glyph, e.g. a merely "good" move). */
const qualityGlyphs: Record<MoveClassification, string> = {
  best: "!",
  excellent: "!!",
  good: "",
  inaccuracy: "?!",
  mistake: "?",
  blunder: "??",
  missed_tactic: "T",
  human_error: "H"
};

function qualityGlyph(classification: MoveClassification): string {
  return qualityGlyphs[classification] ?? "";
}

/**
 * The one move-quality badge, on the shared `qualityTone` colours.
 * - `variant="label"` (default): pill with the verdict ("Best", "Inaccuracy") — review headers, inspector summary.
 * - `variant="glyph"`: tiny inline tag with the annotation ("!", "?!") — move lists. Renders nothing for "good".
 * `selected` renders the glyph on a selected (accent-filled) row.
 */
function QualityBadge({
  classification,
  variant = "label",
  selected = false,
  className
}: {
  classification: MoveClassification;
  variant?: "label" | "glyph";
  selected?: boolean;
  className?: string;
}) {
  if (variant === "glyph") {
    const glyph = qualityGlyph(classification);
    if (!glyph) return null;
    return (
      <span
        className={cn(
          "min-w-0 shrink-0 truncate rounded-md px-1 font-mono text-2xs font-semibold leading-4",
          selected ? "bg-fg/15 text-fg" : qualityTone[classification].badge,
          className
        )}
      >
        {glyph}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full px-1.5 text-2xs font-medium",
        qualityTone[classification].badge,
        className
      )}
    >
      {reviewLabel(classification)}
    </span>
  );
}

export { QualityBadge };
