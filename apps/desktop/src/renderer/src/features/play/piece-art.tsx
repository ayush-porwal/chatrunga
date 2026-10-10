import type { CSSProperties } from "react";
import {
  boardThemeSquareColors,
  cgWrapPieceSetClass,
  defaultSettings,
  hydratePieceSettings
} from "@chaturanga/shared/types/settings";
import type { Color } from "@chaturanga/shared/types/chess";
import { cn } from "@/lib/utils";
import { usePieceSet } from "@/styles/generated-piece-themes";
import { useSettingsQuery } from "../../queries/api";
import { CgPieceGlyph, type PreviewPieceRole } from "../settings/piece-style-preview";

/** The saved board's square colours (theme, or the custom pair), for tiles drawn like squares. */
export function useBoardSquareColors(): { light: string; dark: string } {
  const settings = useSettingsQuery();
  const appearance = hydratePieceSettings({ ...defaultSettings, ...settings.data });
  const preset = boardThemeSquareColors[appearance.boardTheme];
  return {
    light: appearance.boardSquareLight ?? preset.light,
    dark: appearance.boardSquareDark ?? preset.dark
  };
}

/**
 * One piece from the user's piece set (Settings → Board → Piece set), as an illustration: it fills
 * its box, so size it with `className`. Decorative (aria-hidden).
 */
export function PieceArt({
  color,
  piece,
  className,
  style
}: {
  color: Color;
  piece: PreviewPieceRole;
  className?: string;
  style?: CSSProperties;
}) {
  const settings = useSettingsQuery();
  const pieceStyle = hydratePieceSettings({ ...defaultSettings, ...settings.data }).pieceStyle;
  usePieceSet(pieceStyle);
  return (
    <span
      className={cn(
        "cg-wrap relative inline-block shrink-0 overflow-hidden",
        cgWrapPieceSetClass(pieceStyle),
        className
      )}
      // Unlayered `.cg-wrap` rules (display:block, inline-size containment) beat utilities.
      style={{ display: "inline-block", containerType: "normal", ...style }}
      aria-hidden="true"
    >
      <CgPieceGlyph color={color} role={piece} />
    </span>
  );
}

/**
 * A white and a black piece of one kind side by side, tilted towards each other, with a soft
 * shadow: the Play page's illustration (knights for Free board and first run, pawns for an empty
 * library). Knights face each other (the white one mirrored).
 */
export function PiecePair({
  piece,
  className,
  pieceClassName,
  gapClassName = "gap-1.5"
}: {
  piece: PreviewPieceRole;
  className?: string;
  /** Each piece's size (e.g. "size-29"). */
  pieceClassName: string;
  gapClassName?: string;
}) {
  const mirror = piece === "knight" ? " scaleX(-1)" : "";
  return (
    <div className={cn("flex", gapClassName, className)} aria-hidden="true">
      <PieceArt
        color="white"
        piece={piece}
        className={cn("drop-shadow-[0_10px_14px_rgb(0_0_0/0.45)]", pieceClassName)}
        style={{ transform: `rotate(-8deg)${mirror}` }}
      />
      <PieceArt
        color="black"
        piece={piece}
        className={cn("drop-shadow-[0_10px_14px_rgb(0_0_0/0.45)]", pieceClassName)}
        style={{ transform: "rotate(8deg)" }}
      />
    </div>
  );
}
