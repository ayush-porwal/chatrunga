import { useLayoutEffect, useState, type RefObject } from "react";
import { widePreviewBoardSize } from "./play-layout";

/**
 * The wide Play card's preview board edge, measured from the card body's inside (its padding
 * taken off) and kept current as the window resizes. Null until measured, and while not wide.
 */
export function useWidePreviewSize(
  bodyRef: RefObject<HTMLElement | null>,
  wide: boolean
): number | null {
  const [size, setSize] = useState<number | null>(null);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!wide || !body) return;
    const measure = () => {
      const style = getComputedStyle(body);
      const width =
        body.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const height =
        body.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      setSize(widePreviewBoardSize(width, height));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [bodyRef, wide]);
  return wide ? size : null;
}
