/**
 * A reviewed game's phases: opening, middlegame and endgame. The review's charts divide the game
 * with them and its accuracy by phase counts each phase's moves, so both use this one split.
 *
 * - Opening: up to the last book move (the game's `GameOpening.bookEndPly`, from the bundled
 *   opening book). A review from before the book has no book data and takes the first 20 plies; a
 *   game that never reached a named position (a set-up start) has no opening.
 * - Endgame: from the first move after the opening played in a position with at most 6 major and
 *   minor pieces on the board, both sides together (queens, rooks, bishops and knights; kings and
 *   pawns don't count). This is Lichess's definition (scalachess `Divider`).
 * - Middlegame: the moves in between (possibly none).
 */
import type { GameOpening } from "../types/engine";

export type GamePhase = "opening" | "middlegame" | "endgame";

/** The opening's length, in plies, for a review without book data. */
export const OPENING_PLIES_WITHOUT_BOOK = 20;

/** A position with at most this many queens, rooks, bishops and knights (both sides) is an endgame. */
export const ENDGAME_MAX_PIECES = 6;

export type GamePhases = {
  /** The last ply of the opening (0: no opening). */
  openingEnd: number;
  /** The first ply of the endgame; null when the game never reached one. */
  endgameStart: number | null;
};

/** Queens, rooks, bishops and knights on the board of a FEN, both sides together. */
export function majorAndMinorPieces(fen: string): number {
  const board = fen.trim().split(/\s+/)[0] ?? "";
  let count = 0;
  for (const char of board) if ("qrbnQRBN".includes(char)) count += 1;
  return count;
}

/** The position is an endgame: few enough major and minor pieces are left. */
export function isEndgamePosition(fen: string): boolean {
  return majorAndMinorPieces(fen) <= ENDGAME_MAX_PIECES;
}

/**
 * The phases of a game from its main-line moves (in order, `ply` from 1) and its opening: the
 * review's `GameReview.opening` (null: no named position reached; undefined: no book data).
 */
export function gamePhases(
  moves: readonly { ply: number; fenBefore: string }[],
  opening: GameOpening | null | undefined
): GamePhases {
  const openingEnd =
    opening === undefined ? OPENING_PLIES_WITHOUT_BOOK : (opening?.bookEndPly ?? 0);
  const endgame = moves.find((move) => move.ply > openingEnd && isEndgamePosition(move.fenBefore));
  return { openingEnd, endgameStart: endgame?.ply ?? null };
}

/** The phase a move (by its ply) was played in. */
export function phaseOfPly(ply: number, phases: GamePhases): GamePhase {
  if (ply <= phases.openingEnd) return "opening";
  if (phases.endgameStart !== null && ply >= phases.endgameStart) return "endgame";
  return "middlegame";
}
