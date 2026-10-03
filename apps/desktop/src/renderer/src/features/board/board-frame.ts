/**
 * Board frame geometry (BoardStage, useBoardFrame).
 *
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
