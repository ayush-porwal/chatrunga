import { applyUserMove } from "@chaturanga/shared/chess/position";
import { standardCastlingUci } from "@chaturanga/shared/chess/review";
import type { UserMove } from "@chaturanga/shared/types/chess";
import { userMoveBetween } from "@/lib/uci";

/** A legal move resolved against a position: standard UCI (castling as `e1g1`), SAN and the FEN after. */
export type ResolvedMove = { uci: string; san: string; fenAfter: string };

/**
 * The legal move between two squares in `fen` (a board drag or click), or null when it isn't legal
 * or the position can't be read. Castling comes back in standard king-destination UCI even when the
 * king was dropped on its rook.
 */
export function resolveBoardMove(
  fen: string,
  from: string,
  to: string,
  promotion?: UserMove["promotion"]
): ResolvedMove | null {
  const move = userMoveBetween(from, to, promotion);
  if (!move) return null;
  return resolved(fen, () => applyUserMove(fen, move));
}

/** Runs a chessops move application, tolerating an unreadable FEN, and normalises castling UCI. */
function resolved(
  fen: string,
  apply: () => { fen: string; san: string; uci: string } | null
): ResolvedMove | null {
  try {
    const result = apply();
    if (!result) return null;
    return { uci: standardCastlingUci(fen, result.uci), san: result.san, fenAfter: result.fen };
  } catch {
    return null;
  }
}
