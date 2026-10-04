import { promotionSuffix } from "@chaturanga/shared/chess/position";
import type { Square, UserMove } from "@chaturanga/shared/types/chess";
import { isSquare, uciSquares } from "@chaturanga/shared/chess/square";

type Promotion = NonNullable<UserMove["promotion"]>;

const PROMOTION_BY_LETTER: Record<string, Promotion> = { q: "queen", r: "rook", b: "bishop", n: "knight" };

const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
/** A board square name, checked (`"e4"`), or null for anything else (Chessground keys include "a0"). */
export function asSquare(value: string): Square | null {
  return isSquare(value) ? value : null;
}

export function isUciMove(value: string): boolean {
  return UCI_MOVE.test(value);
}

/** `e7e8q` → `{ from: "e7", to: "e8", promotion: "queen" }`; null for text that isn't a UCI move. The caller checks legality. */
export function userMoveFromUci(uci: string): UserMove | null {
  const squares = isUciMove(uci) ? uciSquares(uci) : null;
  if (!squares) return null;
  return {
    from: squares[0],
    to: squares[1],
    promotion: PROMOTION_BY_LETTER[uci.slice(4, 5)]
  };
}

/** The move between two squares (Chessground keys, or a stored pending promotion); null if either isn't a square. */
export function userMoveBetween(from: string, to: string, promotion?: Promotion): UserMove | null {
  const origin = asSquare(from);
  const target = asSquare(to);
  return origin && target ? { from: origin, to: target, promotion } : null;
}

/** `{ from: "e7", to: "e8", promotion: "queen" }` → `e7e8q`. */
export function uciFromUserMove(move: { from: string; to: string; promotion?: Promotion }): string {
  return `${move.from}${move.to}${promotionSuffix(move.promotion)}`;
}
