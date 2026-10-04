import type { Square } from "../types/chess";

const SQUARE = /^[a-h][1-8]$/;

/** Whether `value` names a board square ("e4"). Chessground's keys also include "a0", which isn't one. */
export function isSquare(value: string): value is Square {
  return SQUARE.test(value);
}

/** The squares a UCI move goes from and to ("e7e8q" → ["e7", "e8"]); null for anything else. */
export function uciSquares(uci: string): [from: Square, to: Square] | null {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  return isSquare(from) && isSquare(to) ? [from, to] : null;
}
