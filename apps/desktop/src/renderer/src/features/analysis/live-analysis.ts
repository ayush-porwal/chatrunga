import { statusForFen } from "@chaturanga/shared/chess/position";
import type { GameMode, MoveNode } from "@chaturanga/shared/types/chess";
import { currentLineUcis } from "./engine-game-helpers";

/** The game board as live analysis reads it. */
export type AnalysisBoard = {
  mode: GameMode;
  rootFen: string;
  currentNodeId: string;
  currentFen: string;
  moveTree: MoveNode[];
  /** A decided game's result: no search then. */
  gameOutcome: object | null;
};

/**
 * The position live analysis searches now: where its moves start, the moves (in UCI, built only
 * when a search starts) and the position they reach. `key` names it: the same key is the same
 * search, so it isn't started again.
 */
export type AnalysisSubject = {
  key: string;
  rootFen: string;
  fen: string;
  moves: () => string[];
};

/**
 * What live analysis searches: the board's position in analysis mode, unless the game is decided
 * or the position is over (mate, stalemate). Null when nothing is to be searched.
 */
export function liveAnalysisSubject(board: AnalysisBoard): AnalysisSubject | null {
  if (board.mode !== "analysis" || board.gameOutcome || statusForFen(board.currentFen).isEnd) {
    return null;
  }
  return {
    key: `${board.rootFen}|${board.currentNodeId}|${board.currentFen}`,
    rootFen: board.rootFen,
    fen: board.currentFen,
    moves: () => currentLineUcis(board.moveTree, board.currentNodeId)
  };
}
