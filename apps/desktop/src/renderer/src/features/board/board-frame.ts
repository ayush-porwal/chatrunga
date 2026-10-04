// Board frame geometry for BoardStage and BoardWorkspace (applied by the hooks in useBoardFrame and
// the board's two resize affordances: the corner grip in BoardResizeGrip and the splitter in
// BoardSplitter).

/**
 * Chessground draws whole-device-pixel squares: it sizes its <cg-container> to
 * `floor(width · dpr / 8) · 8 / dpr` of its wrapper (render.ts `updateBounds`) and pins it top-left.
 * A frame of any other size shows a strip of up to 8 device pixels on the right and bottom, so the
 * frame is sized to that same rounded edge instead and the board fills it exactly.
 */
export function snapBoardSize(available: number, devicePixelRatio: number): number {
  if (!(available > 0) || !(devicePixelRatio > 0)) return 0;
  // The epsilon keeps an edge that is already whole (8k device px) from losing a step to float error.
  const squares = Math.floor((available * devicePixelRatio) / 8 + 1e-9);
  return (squares * 8) / devicePixelRatio;
}

/**
 * Focus mode: the insets that trim the span from `start` to `end` (the workspace's edges, in window
 * coordinates) to the longest span centred on a window `length` long. The workspace sits under
 * the titlebar (and any notice) with only a small gap above the window's bottom edge, so its own
 * centre is lower than the window's; padded by these insets, what it centres is centred on the window.
 */
export function centringInsets(
  start: number,
  end: number,
  length: number
): { start: number; end: number } {
  const centre = length / 2;
  const half = Math.max(0, Math.min(centre - start, end - centre));
  return { start: Math.max(0, centre - half - start), end: Math.max(0, end - centre - half) };
}

/**
 * The smallest edge (CSS px) the corner grip or the splitter resizes the board to: the side panel
 * takes the rest, and below this the board's squares get too small to play on.
 */
export const MIN_BOARD_EDGE = 280;

/**
 * The edge a remembered resize restores (null: the board fills its space). An edge saved before
 * the minimum was raised comes back at the minimum. How far the workspace lets it reach beside the
 * panel is CSS's to clamp (`--workspace-board-max`), as the window can change size at any time.
 */
export function restoredBoardEdge(stored: number | null): number | null {
  return stored === null ? null : Math.max(MIN_BOARD_EDGE, stored);
}

/**
 * A resized board's edge kept between MIN_BOARD_EDGE and `max`, the largest edge the workspace
 * leaves beside the side panel at its minimum width. A space smaller than the minimum wins.
 */
export function clampBoardEdge(edge: number, max: number): number {
  return Math.max(0, Math.min(max, Math.max(MIN_BOARD_EDGE, edge)));
}

/**
 * The board's edge while its bottom-right grip is dragged `dx` across and `dy` down from where the
 * drag started at edge `start` (clampBoardEdge). The board is anchored at its cell's left edge and
 * centred down it, so an edge change of d moves the grip d across but only d/2 down. The edge
 * follows the axis the pointer moved most along, `dx` across or `2·dy` down, growing or shrinking
 * as a square: straight left or up shrinks it, straight right or down grows it, and the grip stays
 * under the pointer along that axis.
 */
export function draggedBoardEdge(start: number, dx: number, dy: number, max: number): number {
  const down = 2 * dy;
  return clampBoardEdge(start + (Math.abs(dx) >= Math.abs(down) ? dx : down), max);
}

/**
 * The board's edge while the splitter between the board and the side panel is dragged `dx` across
 * from where the drag started at edge `start` (clampBoardEdge): left shrinks the board and widens
 * the panel by as much, right does the reverse.
 */
export function splitterBoardEdge(start: number, dx: number, max: number): number {
  return clampBoardEdge(start + dx, max);
}

/** The splitter's arrow-key step (CSS px), and with Shift held. */
export const BOARD_SPLITTER_STEP = 16;
export const BOARD_SPLITTER_STEP_LARGE = 64;

/**
 * What a key does on the splitter between the board and the side panel, from the board's current
 * `edge`: ArrowLeft / ArrowRight step the board's edge down / up (by BOARD_SPLITTER_STEP, or
 * BOARD_SPLITTER_STEP_LARGE with Shift), Home and End go to the smallest and largest edge
 * (clampBoardEdge), and Enter goes back to filling the space ("fill"). Null for any other key.
 */
export function keyedBoardEdge(
  key: string,
  shift: boolean,
  edge: number,
  max: number
): number | "fill" | null {
  const step = shift ? BOARD_SPLITTER_STEP_LARGE : BOARD_SPLITTER_STEP;
  switch (key) {
    case "ArrowLeft":
      return clampBoardEdge(edge - step, max);
    case "ArrowRight":
      return clampBoardEdge(edge + step, max);
    case "Home":
      return clampBoardEdge(MIN_BOARD_EDGE, max);
    case "End":
      return clampBoardEdge(max, max);
    case "Enter":
      return "fill";
    default:
      return null;
  }
}
