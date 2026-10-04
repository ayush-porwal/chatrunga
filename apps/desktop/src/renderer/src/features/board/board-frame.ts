// Board frame geometry for BoardStage and BoardWorkspace (applied by the hooks in useBoardFrame).

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
