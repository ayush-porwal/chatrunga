import { useEffect, useMemo, type RefObject } from "react";
import {
  boardThemeSquareColors,
  cgWrapPieceSetClass,
  defaultSettings,
  hydratePieceSettings,
  piecePresentationTailwindClass,
  type AppSettings
} from "@chaturanga/shared/types/settings";
import { useSettingsQuery } from "../../queries/api";
import { cn } from "@/lib/utils";

/** 8×8 checkerboard as a CSS background (use with `background-size: 25% 25%`). */
export function boardSquareGradient(light: string, dark: string): string {
  return `conic-gradient(${dark} 25%, ${light} 0 50%, ${dark} 0 75%, ${light} 0)`;
}

/**
 * Board look from the saved settings: the hydrated appearance, the square background and the
 * classes for the Chessground mount node (piece set + piece presentation).
 */
export function useBoardAppearance(): {
  appearance: AppSettings;
  squareBackground: string;
  pieceClassName: string;
} {
  const settings = useSettingsQuery();
  const appearance = hydratePieceSettings({ ...defaultSettings, ...(settings.data ?? {}) });
  const preset = boardThemeSquareColors[appearance.boardTheme];
  const light = appearance.boardSquareLight ?? preset.light;
  const dark = appearance.boardSquareDark ?? preset.dark;
  const squareBackground = useMemo(() => boardSquareGradient(light, dark), [light, dark]);
  return {
    appearance,
    squareBackground,
    pieceClassName: cn(cgWrapPieceSetClass(appearance.pieceStyle), piecePresentationTailwindClass(appearance.piecePresentation))
  };
}

/**
 * Paints the squares of the Chessground board mounted in `elementRef`.
 *
 * Chessground creates `<cg-board>` itself and its board skin is unlayered CSS, which beats
 * Tailwind's layered utilities — so the colours go inline on `<cg-board>` and are re-applied
 * whenever Chessground rebuilds its DOM.
 */
export function useCgBoardBackground(elementRef: RefObject<HTMLElement | null>, background: string): void {
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
    const observer = new MutationObserver(apply);
    observer.observe(element, { childList: true, subtree: true });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [elementRef, background]);
}
