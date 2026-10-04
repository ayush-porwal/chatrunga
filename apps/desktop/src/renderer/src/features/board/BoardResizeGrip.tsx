import {
  createContext,
  useContext,
  useRef,
  useState,
  type PointerEvent,
  type RefObject
} from "react";
import { draggedBoardEdge } from "./board-frame";
import { useBoardEdgeStore } from "./useBoardEdge";
import "./board.css";

/**
 * Provided by a <BoardWorkspace> while its side panel shows (never in focus mode, where the board
 * always fills): `maxRef` measures the largest edge the board can take beside the panel at its
 * minimum width (`--workspace-board-max`). Null elsewhere, and then the board has no grip.
 */
export const BoardResizeContext = createContext<{
  maxRef: RefObject<HTMLElement | null>;
} | null>(null);

type Drag = { pointerId: number; x: number; y: number; start: number; max: number };

/**
 * The board's resize grip, in its frame's bottom-right corner: neutral diagonal lines that show
 * only while the pointer is over that corner or dragging it (board.css). Dragging resizes the
 * board as a square (draggedBoardEdge) and the side panel takes the width it frees; a
 * double-click goes back to filling the space. One of the board's two resize affordances, with
 * the splitter in the gap beside the panel (BoardSplitter): both drive the same edge
 * (useBoardEdge), so either picks up where the other left it. A pointer affordance only: the
 * splitter is the one that takes focus and steps with the keys, so the grip adds no keys next to
 * the board's own. `availRef` measures the board's current edge (BoardStage's `--board-avail`).
 */
export function BoardResizeGrip({ availRef }: { availRef: RefObject<HTMLElement | null> }) {
  const resizable = useContext(BoardResizeContext);
  const resize = useBoardEdgeStore((state) => state.resize);
  const commit = useBoardEdgeStore((state) => state.commit);
  const fill = useBoardEdgeStore((state) => state.fill);
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);
  if (!resizable) return null;

  const start = (event: PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    const edge = availRef.current?.getBoundingClientRect().width;
    const max = resizable.maxRef.current?.getBoundingClientRect().width;
    if (!edge || !max) return;
    // No text selection, and nothing under the corner (the board) sees the press.
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start: edge,
      max
    };
    setDragging(true);
  };
  const move = (event: PointerEvent<HTMLSpanElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    resize(
      draggedBoardEdge(
        current.start,
        event.clientX - current.x,
        event.clientY - current.y,
        current.max
      )
    );
  };
  const end = (event: PointerEvent<HTMLSpanElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    commit();
  };

  return (
    <span
      aria-hidden="true"
      className="board-resize-grip"
      data-dragging={dragging || undefined}
      title="Drag to resize the board · double-click to fit it to the space"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={fill}
    />
  );
}
