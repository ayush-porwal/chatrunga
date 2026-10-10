import { useEffect, useMemo, type RefObject } from "react";
import {
  boardThemeSquareColors,
  cgWrapPieceSetClass,
  defaultSettings,
  hydratePieceSettings,
  pieceSizesClass,
  type AppSettings
} from "@chaturanga/shared/types/settings";
import { useSettingsQuery } from "../../queries/api";
import { usePieceSet } from "@/styles/generated-piece-themes";
import { cn } from "@/lib/utils";

/** 8×8 checkerboard as a CSS background (use with `background-size: 25% 25%`). */
export function boardSquareGradient(light: string, dark: string): string {
  return `conic-gradient(${dark} 25%, ${light} 0 50%, ${dark} 0 75%, ${light} 0)`;
}

/**
 * Board look from the saved settings: the hydrated appearance, the square background and the
 * classes for the Chessground mount node (piece set + piece sizes), with the set's CSS loaded.
 */
export function useBoardAppearance(): {
  appearance: AppSettings;
  squareBackground: string;
  /** The theme's square colours (coordinates and highlights are tinted against them). */
  squareColors: BoardSquareColors;
  pieceClassName: string;
} {
  const settings = useSettingsQuery();
  const appearance = hydratePieceSettings({ ...defaultSettings, ...settings.data });
  const preset = boardThemeSquareColors[appearance.boardTheme];
  const light = appearance.boardSquareLight ?? preset.light;
  const dark = appearance.boardSquareDark ?? preset.dark;
  const squareBackground = useMemo(() => boardSquareGradient(light, dark), [light, dark]);
  const squareColors = useMemo(() => ({ light, dark }), [light, dark]);
  usePieceSet(appearance.pieceStyle);
  return {
    appearance,
    squareBackground,
    squareColors,
    pieceClassName: cn(
      cgWrapPieceSetClass(appearance.pieceStyle),
      pieceSizesClass(appearance.pieceSizes)
    )
  };
}

export type BoardSquareColors = { light: string; dark: string };

/**
 * Paints the squares of the Chessground board mounted in `elementRef`.
 *
 * Chessground creates `<cg-board>` itself and its board skin is unlayered CSS, which beats
 * Tailwind's layered utilities — so the colours go inline on `<cg-board>` and are re-applied
 * whenever Chessground rebuilds its DOM. The two colours also go on the mount node as
 * `--cg-sq-light` / `--cg-sq-dark` for coordinates (board.css).
 */
export function useCgBoardBackground(
  elementRef: RefObject<HTMLElement | null>,
  background: string,
  colors?: BoardSquareColors
): void {
  const light = colors?.light;
  const dark = colors?.dark;
  useEffect(() => {
    const element = elementRef.current;
    if (!element || !light || !dark) return;
    element.style.setProperty("--cg-sq-light", light);
    element.style.setProperty("--cg-sq-dark", dark);
  }, [elementRef, light, dark]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const apply = () => {
      const board = element.querySelector<HTMLElement>("cg-board");
      // The browser normalises inline colours, so remember what was applied on the element itself.
      if (!board || board.dataset.squareBackground === background) return;
      board.style.backgroundImage = background;
      board.style.backgroundSize = "25% 25%";
      board.dataset.squareBackground = background;
    };
    apply();
    const frame = window.requestAnimationFrame(apply);
    // Chessground only replaces <cg-board> when it rebuilds its DOM (cg-container is re-added to the
    // mount node), so watching the mount node's direct children is enough — not every piece move.
    const observer = new MutationObserver(apply);
    observer.observe(element, { childList: true });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [elementRef, background]);
}
