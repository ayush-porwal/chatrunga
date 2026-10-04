import { cn } from "@/lib/utils";
import { CgPieceGlyph, type PreviewPieceRole } from "../settings/piece-style-preview";

/**
 * A white piece of the board's own set, sized to the text, for figurine notation (`♘f3`). Must sit
 * inside a `.cg-wrap` carrying the board's piece-set class (see useBoardAppearance).
 */
export function Figurine({ role, className }: { role: PreviewPieceRole; className?: string }) {
  return (
    // The sprites carry their own padding: pulled in so the piece sits against its square (♘f6).
    <span
      className={cn(
        "relative -mr-[0.14em] -ml-[0.06em] inline-block size-[1.35em] overflow-hidden align-[-0.32em]",
        className
      )}
    >
      <CgPieceGlyph color="white" role={role} />
    </span>
  );
}
