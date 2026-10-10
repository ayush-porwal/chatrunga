import { useLayoutEffect, useRef } from "react";
import {
  cgWrapPieceSetClass,
  pieceSizesClass,
  type PieceSizes,
  type PieceStyle
} from "@chaturanga/shared/types/settings";
import { cn } from "@/lib/utils";
import { usePieceSet } from "@/styles/generated-piece-themes";

export type PreviewPieceRole = "pawn" | "rook" | "knight" | "bishop" | "queen" | "king";

/** Mirrors Chessground `piece` rules from `chessground.base.css`, but anchored to each preview cell instead of full board geometry. */
const previewCellPieceClass =
  "pointer-events-none absolute inset-0 !left-0 !top-0 !box-border !h-full !w-full max-h-none max-w-none bg-cover";

/**
 * One piece sprite, drawn by the same CSS that skins the board (`.cg-wrap piece.white.king`, per
 * piece set). Those rules match the `<piece>` element Chessground uses, which React cannot render
 * without an "unrecognized tag" warning, so the element is created directly inside a
 * `display: contents` span. Must sit inside a `.cg-wrap` with the piece-set class.
 */
export function CgPieceGlyph({
  color,
  role
}: {
  color: "white" | "black";
  role: PreviewPieceRole;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const piece = document.createElement("piece");
    piece.className = cn(color, role, previewCellPieceClass);
    host.replaceChildren(piece);
    return () => piece.remove();
  }, [color, role]);
  return <span ref={hostRef} className="contents" aria-hidden="true" />;
}

const STRIP_PIECES = [
  { color: "white", role: "king" },
  { color: "white", role: "queen" },
  { color: "white", role: "knight" },
  { color: "black", role: "king" }
] as const;

/** Inline preview for a piece set (compact row for settings / listbox options). */
export function PieceStylePreviewStrip({
  pieceStyle,
  pieceSizes,
  density = "default"
}: {
  pieceStyle: PieceStyle;
  pieceSizes: PieceSizes;
  density?: "default" | "compact";
}) {
  const isCompact = density === "compact";
  usePieceSet(pieceStyle);
  return (
    <div
      className={cn(
        "cg-wrap inline-flex shrink-0 items-center gap-0.5 rounded-md border border-line bg-surface-sunken px-1.5",
        isCompact ? "h-8" : "h-9",
        cgWrapPieceSetClass(pieceStyle),
        pieceSizesClass(pieceSizes)
      )}
      // Unlayered `.cg-wrap` rules (chessground display:block, board.css inline-size containment) beat
      // utilities and would collapse this shrink-to-fit strip to zero width; inline style wins.
      style={{ display: "inline-flex", containerType: "normal" }}
      aria-hidden
    >
      {STRIP_PIECES.map(({ color, role }) => (
        <span
          key={`${color}-${role}`}
          className={cn(
            "relative inline-block shrink-0 overflow-hidden",
            color === "black"
              ? isCompact
                ? "size-5.5"
                : "size-6.5"
              : isCompact
                ? "size-6"
                : "size-7"
          )}
        >
          <CgPieceGlyph color={color} role={role} />
        </span>
      ))}
    </div>
  );
}
