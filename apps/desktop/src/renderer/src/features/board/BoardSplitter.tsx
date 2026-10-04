import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject
} from "react";
import { cn } from "@/lib/utils";
import { MIN_BOARD_EDGE, splitterBoardEdge } from "./board-frame";
import { useBoardEdgeStore } from "./useBoardEdge";

type Drag = { pointerId: number; x: number; start: number; max: number };

const width = (ref: RefObject<HTMLElement | null>) =>
  ref.current?.getBoundingClientRect().width ?? 0;

/** The board's current edge and the largest it can reach, measured for the separator's value. */
function useMeasuredEdges(
  edgeRef: RefObject<HTMLElement | null>,
  maxRef: RefObject<HTMLElement | null>
) {
  const [edges, setEdges] = useState({ edge: 0, max: 0 });
  useLayoutEffect(() => {
    const edge = edgeRef.current;
    const max = maxRef.current;
    if (!edge || !max) return;
    const update = () =>
      setEdges((last) => {
        const next = { edge: width(edgeRef), max: width(maxRef) };
        return next.edge === last.edge && next.max === last.max ? last : next;
      });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(edge);
    observer.observe(max);
    return () => observer.disconnect();
  }, [edgeRef, maxRef]);
  return edges;
}

/**
 * The splitter between the board and the side panel (BoardWorkspace, while the panel shows): a
 * thin neutral line in the gap, with a wider hit area, that brightens while hovered, focused or
 * dragged (like the review charts' splitter). It drives the same board edge as the corner grip
 * (BoardResizeGrip): dragging it left by d shrinks the board by d and the panel takes the width,
 * right does the reverse (splitterBoardEdge), within the minimum board and the panel's minimum
 * width. A drag starts from the board's measured edge, so a board limited by the height moves
 * with the first pixel. The arrow keys step it (Shift: further), Home and End go to the smallest
 * and largest board; Enter or a double-click fills the space again. `edgeRef` measures the board's
 * current edge, `maxRef` the largest it can take.
 */
export function BoardSplitter({
  edgeRef,
  maxRef,
  className
}: {
  edgeRef: RefObject<HTMLElement | null>;
  maxRef: RefObject<HTMLElement | null>;
  className?: string;
}) {
  const resize = useBoardEdgeStore((state) => state.resize);
  const commit = useBoardEdgeStore((state) => state.commit);
  const key = useBoardEdgeStore((state) => state.key);
  const fill = useBoardEdgeStore((state) => state.fill);
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);
  const { edge, max } = useMeasuredEdges(edgeRef, maxRef);

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const from = width(edgeRef);
    const limit = width(maxRef);
    if (!from || !limit) return;
    // No text selection while dragging.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, x: event.clientX, start: from, max: limit };
    setDragging(true);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    resize(splitterBoardEdge(current.start, event.clientX - current.x, current.max));
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    commit();
  };
  const press = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const limit = width(maxRef);
    if (!limit) return;
    // The page's own arrows, Home and End move through the game; here they size the board.
    if (key(event.key, event.shiftKey, width(edgeRef), limit)) event.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize board and panel"
      aria-valuenow={Math.round(edge)}
      aria-valuemin={Math.round(Math.min(MIN_BOARD_EDGE, max))}
      aria-valuemax={Math.round(max)}
      tabIndex={0}
      title="Drag to resize the board and the panel · double-click to fit the board to the space"
      data-dragging={dragging || undefined}
      className={cn(
        "group/splitter relative w-2.5 cursor-col-resize touch-none outline-none",
        className
      )}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={fill}
      onKeyDown={press}
    >
      {/* The resting line, and a neutral highlight over it while hovered, focused or dragged. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line-subtle"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full transition-colors duration-micro ease-standard group-hover/splitter:bg-fg/15 group-focus-visible/splitter:bg-fg/25 group-data-[dragging]/splitter:bg-fg/20"
      />
    </div>
  );
}
