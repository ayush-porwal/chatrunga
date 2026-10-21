import { useLayoutEffect, useState, type RefObject } from "react";

/** An element's content box: its width and height less its padding. */
export type ContentBox = { width: number; height: number };

/**
 * The content box of the element in `ref` (its padding taken off), kept current as the window
 * resizes; null until measured (before the first paint) and while not `active`. With
 * `viewportHeight` the height is the visible one of the scroll area around it (its parent's), not
 * its content's: the Play page sizes its rows from the window.
 */
export function useContentBox(
  ref: RefObject<HTMLElement | null>,
  { active = true, viewportHeight = false }: { active?: boolean; viewportHeight?: boolean } = {}
): ContentBox | null {
  const [box, setBox] = useState<ContentBox | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    const heightFrom = viewportHeight ? element?.parentElement : element;
    if (!active || !element || !heightFrom) return;
    const measure = () => {
      const style = getComputedStyle(element);
      const width =
        element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const height =
        heightFrom.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      setBox((previous) =>
        previous?.width === width && previous.height === height ? previous : { width, height }
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(heightFrom);
    return () => observer.disconnect();
  }, [ref, active, viewportHeight]);
  return active ? box : null;
}
