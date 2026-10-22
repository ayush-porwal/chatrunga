import { useLayoutEffect, useState } from "react";

/** The element's laid-out width in CSS pixels (0 until measured), kept up to date. */
export function useWidth(): [
  (element: HTMLDivElement | null) => void,
  number,
  HTMLDivElement | null
] {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!element) return;
    setWidth(Math.round(element.getBoundingClientRect().width));
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, width, element];
}
