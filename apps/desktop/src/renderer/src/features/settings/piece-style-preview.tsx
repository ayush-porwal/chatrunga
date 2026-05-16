import { createElement } from "react";
import {
  cgWrapPieceSetClass,
  piecePresentationTailwindClass,
  type PiecePresentation,
  type PieceStyle
} from "@chaturanga/shared/types/settings";
import { cn } from "@/lib/utils";

export type PreviewPieceRole = "pawn" | "rook" | "knight" | "bishop" | "queen" | "king";

/** Mirrors Chessground `piece` rules from `chessground.base.css`, but anchored to each preview cell instead of full board geometry. */
const previewCellPieceClass =
  "pointer-events-none absolute inset-0 !left-0 !top-0 !box-border !h-full !w-full max-h-none max-w-none bg-cover";

export function CgPieceGlyph({
  color,
  role,
  className
}: {
  color: "white" | "black";
  role: PreviewPieceRole;
  className?: string;
}) {
  return createElement("piece", {
    className: cn(color, role, previewCellPieceClass, className)
  });
}

/** Inline preview for a piece set (compact row for settings / listbox options). */
export function PieceStylePreviewStrip({
  pieceStyle,
  piecePresentation,
  density = "default"
}: {
  pieceStyle: PieceStyle;
  piecePresentation: PiecePresentation;
  density?: "default" | "compact";
}) {
  const isCompact = density === "compact";
  return (
    <div
      className={cn(
        "cg-wrap inline-flex shrink-0 items-center gap-0.5 rounded-md border border-[#303030] bg-[#141619] px-1.5",
        isCompact ? "h-8" : "h-9",
        cgWrapPieceSetClass(pieceStyle),
        piecePresentationTailwindClass(piecePresentation)
      )}
      aria-hidden
    >
      <span className={cn("relative inline-block shrink-0 overflow-hidden", isCompact ? "size-6" : "size-7")}>
        <CgPieceGlyph color="white" role="king" />
      </span>
      <span className={cn("relative inline-block shrink-0 overflow-hidden", isCompact ? "size-6" : "size-7")}>
        <CgPieceGlyph color="white" role="queen" />
      </span>
      <span className={cn("relative inline-block shrink-0 overflow-hidden", isCompact ? "size-6" : "size-7")}>
        <CgPieceGlyph color="white" role="knight" />
      </span>
      <span
        className={cn(
          "relative inline-block shrink-0 overflow-hidden",
          isCompact ? "size-[22px]" : "size-[26px]"
        )}
      >
        <CgPieceGlyph color="black" role="king" />
      </span>
    </div>
  );
}
