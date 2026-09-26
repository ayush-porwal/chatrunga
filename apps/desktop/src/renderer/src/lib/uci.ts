import { promotionSuffix } from "@chaturanga/shared/chess/position";
import type { Square, UserMove } from "@chaturanga/shared/types/chess";

type Promotion = NonNullable<UserMove["promotion"]>;

const PROMOTION_BY_LETTER: Record<string, Promotion> = { q: "queen", r: "rook", b: "bishop", n: "knight" };

const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export function isUciMove(value: string): boolean {
  return UCI_MOVE.test(value);
}

/** `e7e8q` → `{ from: "e7", to: "e8", promotion: "queen" }`. The caller checks legality. */
export function userMoveFromUci(uci: string): UserMove {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: PROMOTION_BY_LETTER[uci.slice(4, 5)]
  };
}

/** `{ from: "e7", to: "e8", promotion: "queen" }` → `e7e8q`. */
export function uciFromUserMove(move: { from: string; to: string; promotion?: Promotion }): string {
  return `${move.from}${move.to}${promotionSuffix(move.promotion)}`;
}
