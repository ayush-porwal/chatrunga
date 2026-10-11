/**
 * Full moves in `plies` half-moves from a start position: White's move and Black's reply count as
 * one, and so does a move still waiting for its reply (a lone White move, or a game from a
 * Black-to-move position opening with Black's move). 12 plies from the start are 6 moves, 13 are 7.
 */
export function fullMoveCount(plies: number, blackFirst = false): number {
  if (plies <= 0) return 0;
  return Math.ceil((plies + (blackFirst ? 1 : 0)) / 2);
}

/** Whether a position (FEN) has Black to move: a game from it opens with Black's move. */
export function blackToMove(fen: string | null | undefined): boolean {
  return fen?.trim().split(/\s+/)[1] === "b";
}
