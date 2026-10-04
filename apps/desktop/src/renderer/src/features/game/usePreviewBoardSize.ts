import { useLayoutEffect, useState, type RefObject } from "react";
import { previewBoardSize } from "./move-list-model";

/**
 * The edge of a line's preview board (a BEST line's, an engine line's): as wide as `slotRef`'s
 * room, within previewBoardSize's bounds (at most 340px and 60% of the main board, at least
 * 200px). Null until measured; follows the room as it resizes.
 */
export function usePreviewBoardSize(slotRef: RefObject<HTMLElement | null>): number | null {
  const [size, setSize] = useState<number | null>(null);
  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;
    const measure = () => {
      const board = document.querySelector('section[aria-label="Board"] cg-board');
      const mainBoard = board ? board.getBoundingClientRect().width : null;
      setSize(previewBoardSize(slot.clientWidth, mainBoard));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    return () => observer.disconnect();
  }, [slotRef]);
  return size;
}
