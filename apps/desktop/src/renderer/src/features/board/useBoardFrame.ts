import { useLayoutEffect, type RefObject } from "react";
import { snapBoardSize } from "./board-frame";

/**
 * Sizes the board frame's content box (`--board-size` on `frameRef`) to whole-pixel squares
 * (snapBoardSize) from the space `probeRef` measures. The probe's width comes from the board cell
 * alone, never from the frame, so a new size can't feed back into the next measurement.
 *
 * Runs before paint on mount and inside the ResizeObserver callback afterwards (also before paint),
 * so the frame never shows at a stale size; Chessground's own observer on its wrapper (deeper in
 * the tree) runs in the same frame. A device-pixel-ratio change (window zoom, another display)
 * re-snaps even when the CSS size stays the same.
 */
export function useSnappedBoardFrame(probeRef: RefObject<HTMLElement | null>, frameRef: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const probe = probeRef.current;
    const frame = frameRef.current;
    if (!probe || !frame) return;
    let applied = "";
    const update = () => {
      const style = window.getComputedStyle(frame);
      // Border widths are snapped to device pixels by the browser (under 1px at some ratios): read them.
      const border = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
      const size = `${snapBoardSize(probe.getBoundingClientRect().width - border, window.devicePixelRatio)}px`;
      if (size === applied) return;
      applied = size;
      frame.style.setProperty("--board-size", size);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(probe);
    // A resolution query matches one ratio only: re-arm it for the new ratio on every change.
    let media: MediaQueryList | null = null;
    const onRatioChange = () => {
      watchRatio();
      update();
    };
    const watchRatio = () => {
      media?.removeEventListener("change", onRatioChange);
      media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      media.addEventListener("change", onRatioChange);
    };
    watchRatio();
    return () => {
      observer.disconnect();
      media?.removeEventListener("change", onRatioChange);
    };
  }, [probeRef, frameRef]);
}
