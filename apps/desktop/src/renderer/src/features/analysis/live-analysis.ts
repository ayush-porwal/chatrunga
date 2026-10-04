import { statusForFen } from "@chaturanga/shared/chess/position";
import type { Color, GameMode, MoveNode } from "@chaturanga/shared/types/chess";
import { currentLineUcis } from "./engine-game-helpers";

/** The game board as live analysis reads it. */
export type AnalysisBoard = {
  mode: GameMode;
  rootFen: string;
  currentNodeId: string;
  currentFen: string;
  moveTree: MoveNode[];
  /** The engine's side in an engine game (null otherwise). */
  engineSide: Color | null;
  /** A decided game's result: no search then. */
  gameOutcome: object | null;
};

/**
 * A position off the game board that live analysis searches instead of the board's while it is
 * set: the repertoire study's selected move, while its engine panel is open. Its owner sets it and
 * clears it again (closing the panel, leaving the page).
 */
export type AnalysisTarget = {
  /** What the position belongs to (a study chapter): part of its search key. */
  owner: string;
  nodeId: string;
  rootFen: string;
  /** The moves from `rootFen` to the position, in UCI. */
  moves: readonly string[];
  fen: string;
};

/**
 * Who holds the engine, so analysis of a position off the board must wait: an engine game being
 * played on the board (the engine is its opponent; a search of ours would cut its move short), or
 * a Lichess game (outside help is against its fair-play rules). Null when the engine is free.
 */
export type EngineHolder = "engine-game" | "online-game" | null;

export function engineHolder(
  board: Pick<AnalysisBoard, "mode" | "engineSide" | "gameOutcome">,
  onlineGameLive: boolean
): EngineHolder {
  if (onlineGameLive) return "online-game";
  if (board.mode === "engine" && board.engineSide && !board.gameOutcome) return "engine-game";
  return null;
}

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
 * What live analysis searches: a target's position while one is set (unless the engine is held
 * for a game, see engineHolder), else the board's position in analysis mode unless the game is
 * decided. Never a position that is over (mate, stalemate). Null when nothing is to be searched.
 */
export function liveAnalysisSubject(
  board: AnalysisBoard,
  {
    target = null,
    onlineGameLive = false
  }: { target?: AnalysisTarget | null; onlineGameLive?: boolean } = {}
): AnalysisSubject | null {
  if (target) {
    if (engineHolder(board, onlineGameLive) || statusForFen(target.fen).isEnd) return null;
    return {
      key: `target|${target.owner}|${target.rootFen}|${target.nodeId}|${target.fen}`,
      rootFen: target.rootFen,
      fen: target.fen,
      moves: () => [...target.moves]
    };
  }
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
