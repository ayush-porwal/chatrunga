/*
 * Browsing a BEST line: the board shows a position of the engine's line under a marked error
 * without the game's move tree changing. The line is virtual: only a new move played on the board
 * from one of its positions makes it a real variation (the game store does that).
 */

/** One move of a BEST line: its SAN, its UCI (the board's highlight) and the position after it. */
export type BestLineStep = { san: string; uci: string; fenAfter: string };

/** A line off the game's moves (a BEST line, a scratch line) and the move of it on the board. */
export type LineCursor = {
  /** The game move the line branches from: stepping back before its first move lands there. */
  anchorNodeId: string;
  moves: readonly BestLineStep[];
  index: number;
};

/** The BEST line being browsed and the move of it on the board. */
export type BestLineCursor = LineCursor & {
  /** The marked error the line answers (its anchor is the error's parent): the game stays on it while its line is browsed. */
  markedNodeId: string;
};

/** Where a step takes the board: another move of the line, or back to the game. */
export type LineStepResult<T extends LineCursor> =
  | { kind: "line"; cursor: T }
  /** Stepped back before the line's first move: the game move it branches from, then `stepsLeft` (≤ 0) more along the game. */
  | { kind: "game"; nodeId: string; stepsLeft: number };

/** The line at its `index`-th move (clamped to the line); null for a line without moves. */
export function openBestLine(
  markedNodeId: string,
  anchorNodeId: string,
  moves: readonly BestLineStep[],
  index: number
): BestLineCursor | null {
  if (!moves.length) return null;
  return {
    markedNodeId,
    anchorNodeId,
    moves,
    index: Math.min(Math.max(0, index), moves.length - 1)
  };
}

/**
 * `delta` moves along a line (a BEST or scratch line; ← is -1, → is +1): past its end it stays on the last move; before
 * its first move it returns to the game move the line branches from.
 */
export function stepBestLine<T extends LineCursor>(cursor: T, delta: number): LineStepResult<T> {
  const target = cursor.index + delta;
  if (target < 0) return { kind: "game", nodeId: cursor.anchorNodeId, stepsLeft: target + 1 };
  return {
    kind: "line",
    cursor: { ...cursor, index: Math.min(target, cursor.moves.length - 1) }
  };
}

/** The move of the line on the board. */
export function bestLineStep(cursor: LineCursor): BestLineStep {
  return cursor.moves[cursor.index];
}

/** The line's moves up to the one on the board (SAN): what a new move played there follows. */
export function bestLineSans(cursor: BestLineCursor): string[] {
  return cursor.moves.slice(0, cursor.index + 1).map((move) => move.san);
}

/**
 * The line being browsed, if the board still shows it: the game is on its error and the board on
 * its move. Any other navigation (a game move, the move buttons, a loaded game) moves the board,
 * so a cursor left behind is simply no longer active.
 */
export function activeBestLine(state: {
  bestLine: BestLineCursor | null;
  currentNodeId: string;
  currentFen: string;
}): BestLineCursor | null {
  const cursor = state.bestLine;
  if (!cursor || cursor.markedNodeId !== state.currentNodeId) return null;
  return cursor.moves[cursor.index]?.fenAfter === state.currentFen ? cursor : null;
}
