// Board frame geometry for BoardStage and BoardWorkspace (applied by the hooks in useBoardFrame and
// the corner grip in BoardResizeGrip).

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

/** The smallest edge (CSS px) the corner grip resizes the board to. */
export const MIN_BOARD_EDGE = 240;

/**
 * A resized board's edge kept between MIN_BOARD_EDGE and `max`, the largest edge the workspace
 * leaves beside the side panel at its minimum width. A space smaller than the minimum wins.
 */
export function clampBoardEdge(edge: number, max: number): number {
  return Math.max(0, Math.min(max, Math.max(MIN_BOARD_EDGE, edge)));
}

/**
 * The board's edge while its bottom-right grip is dragged `dx` across and `dy` down from where the
 * drag started at edge `start`: the larger of the two moves, so the board grows or shrinks as a
 * square whichever way the pointer leans (clampBoardEdge).
 */
export function draggedBoardEdge(start: number, dx: number, dy: number, max: number): number {
  return clampBoardEdge(start + Math.max(dx, dy), max);
}
