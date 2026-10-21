import { useLayoutEffect, useState, type RefObject } from "react";

/** A page's content box: its width less its padding, and the height its scroll area shows. */
export type PageContentSize = { width: number; height: number };

/**
 * The content box of the page in `pageRef` (its padding taken off): its width, and the visible
 * height of the scroll area around it (the window's, not the content's), kept current as the
 * window resizes. Null until measured (measured before the first paint).
 */
export function usePageContentSize(pageRef: RefObject<HTMLElement | null>): PageContentSize | null {
  const [size, setSize] = useState<PageContentSize | null>(null);
  useLayoutEffect(() => {
    const page = pageRef.current;
    const viewport = page?.parentElement;
    if (!page || !viewport) return;
    const measure = () => {
      const style = getComputedStyle(page);
      const next = {
        width: page.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        height:
          viewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      };
      setSize((previous) =>
        previous && previous.width === next.width && previous.height === next.height
          ? previous
          : next
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [pageRef]);
  return size;
}
