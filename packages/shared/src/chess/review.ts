import type { EngineScore, TerminalState } from "../types/engine";
import { makeSquare, parseUci } from "chessops/util";
import { positionFromFen, statusForFen } from "./position";

/** Centipawn sentinel for a mate score. */
export const MATE_CENTIPAWNS = 100000;
/** Each extra move to mate costs this much, so mate-in-2 vs mate-in-5 is a small but real loss. */
const MATE_DISTANCE_CP = 10;

/**
 * Converts a score to centipawns in the score's own perspective.
 * `mate N` (N > 0) → winning, faster mates score higher; `mate -N` → losing,
 * slower mates score higher. `mate 0` means the side to move IS checkmated → loss.
 */
export function scoreToCentipawns(score: EngineScore): number {
  if (score.type === "cp") return score.value;
  if (score.value === 0) return -MATE_CENTIPAWNS;
  const distance = Math.min(Math.abs(score.value), 1000) * MATE_DISTANCE_CP;
  return Math.sign(score.value) * (MATE_CENTIPAWNS - distance);
}

/**
 * Rewrites king-takes-own-rook castling (`e1h1`, chessops / lc0 style) to the
 * standard UCI king destination (`e1g1`, Stockfish style) so moves from
 * different sources compare equal. Any other move is returned unchanged.
 */
export function standardCastlingUci(fen: string, uci: string): string {
  try {
    const move = parseUci(uci);
    if (!move || !("from" in move)) return uci;
    const pos = positionFromFen(fen);
    const piece = pos.board.get(move.from);
    const target = pos.board.get(move.to);
    if (piece?.role !== "king" || target?.role !== "rook" || target.color !== piece.color)
      return uci;
    const rank = Math.floor(move.from / 8);
    const file = move.to > move.from ? 6 : 2;
    return `${makeSquare(move.from)}${makeSquare(rank * 8 + file)}`;
  } catch {
    return uci;
  }
}

/** Game-ending state readable from the FEN alone (no repetition history). */
export function terminalStateForFen(fen: string): TerminalState | null {
  try {
    const status = statusForFen(fen);
    if (status.isCheckmate) return "checkmate";
    if (status.isStalemate) return "stalemate";
    if (status.isEnd) return "draw";
    return null;
  } catch {
    return null;
  }
}

export function invertScore(score: EngineScore): EngineScore {
  return { type: score.type, value: -score.value };
}

export function scoreFromWhitePerspective(
  score: EngineScore,
  turn: "white" | "black"
): EngineScore {
  return turn === "white" ? score : invertScore(score);
}

export function formatEngineScore(score: EngineScore | null | undefined): string {
  if (!score) return "-";
  if (score.type === "mate") return `M${score.value}`;
  const value = score.value / 100;
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}
