import type { Color, GameMode } from "@chaturanga/shared/types/chess";
import { userWon } from "../analysis/post-game";

/*
 * The board's game-over moment: telling a game that ends now (a move just played, a result just
 * decided, a puzzle just solved) from one that was already over (loaded finished, or stepped
 * through), and whether that ending is one to celebrate. Pure, so BoardView only wires it up.
 */

/** What the board remembers from one render to the next. */
export type BoardEndState = {
  /** The position shown is finished, or a result is decided. */
  ended: boolean;
  /** A result is decided (resignation, flag, agreement, the Lichess server). */
  outcome: boolean;
  /** Nodes in the move tree (one more: a move was added). */
  treeSize: number;
  /** The node shown. */
  nodeId: string;
  /** The puzzle on the board is solved. */
  puzzleSolved: boolean;
};

/**
 * How the game ended just now: "game" (a move just played finished it, or a result was just
 * decided), "puzzle" (the puzzle was just solved), or null (nothing ended now — a finished game
 * loaded, a step to the end of one, a move played after the end).
 */
export function liveEnding(
  previous: BoardEndState,
  next: BoardEndState & { mode: GameMode; parentId: string | null | undefined }
): "game" | "puzzle" | null {
  if (next.mode === "puzzle") return next.puzzleSolved && !previous.puzzleSolved ? "puzzle" : null;
  if (!next.ended || previous.ended) return null;
  // A move was just played onto the board (not a game loaded, not a step through existing moves).
  const movePlayed = next.treeSize === previous.treeSize + 1 && next.parentId === previous.nodeId;
  return movePlayed || (next.outcome && !previous.outcome) ? "game" : null;
}

/**
 * Whether an ending is one to celebrate: a solved puzzle, or the user's own win against the engine
 * or on Lichess (never a loss, a draw, or a result on a board the user only watched).
 */
export function celebratesEnding(
  ending: "game" | "puzzle" | null,
  game: { result: string; mode: GameMode; engineSide: Color | null }
): boolean {
  if (ending === "puzzle") return true;
  return ending === "game" && userWon(game.result, game.mode, game.engineSide);
}
