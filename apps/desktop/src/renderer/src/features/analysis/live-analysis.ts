import { statusForFen } from "@chaturanga/shared/chess/position";
import type { Color, GameMode, MoveNode } from "@chaturanga/shared/types/chess";
import { numberedLine } from "../game-review/review-utils";
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

/**
 * Live analysis switched off with lines to keep (paused): the position they belong to. They stay
 * shown, frozen, until analysis resumes or the board's engine work ends (see the analysis store).
 */
export type PausedAnalysis = {
  nodeId: string;
  fen: string;
  /** The move that reached the position ("12… Nf6"), or null at the start position. */
  move: string | null;
};

/** The board's position `nodeId` (with `fen`) as a paused analysis's. */
export function pausedAnalysisAt(
  moveTree: readonly MoveNode[],
  nodeId: string,
  fen: string
): PausedAnalysis {
  const node = moveTree.find((item) => item.id === nodeId);
  return { nodeId, fen, move: node?.san ? numberedLine(node.fenBefore, [node.san]) : null };
}

/** The board is on the paused analysis's position: its arrows and score apply there. */
export function onPausedPosition(
  paused: PausedAnalysis | null,
  board: Pick<AnalysisBoard, "currentNodeId" | "currentFen">
): boolean {
  return Boolean(
    paused && paused.nodeId === board.currentNodeId && paused.fen === board.currentFen
  );
}

/**
 * The board shows the live analysis's arrows and score: while it runs, while it is paused on the
 * paused position (elsewhere they would belong to another position), and while a target searches
 * the very position the board shows (Game review's scratch line) once its lines are that
 * position's (`resultFen`, see the analysis store).
 */
export function boardShowsLiveAnalysis(
  board: Pick<AnalysisBoard, "mode" | "currentNodeId" | "currentFen">,
  paused: PausedAnalysis | null,
  search: { target: Pick<AnalysisTarget, "fen"> | null; resultFen: string | null } | null = null
): boolean {
  if (board.mode === "analysis" || onPausedPosition(paused, board)) return true;
  return Boolean(
    search?.target &&
    search.target.fen === board.currentFen &&
    search.resultFen === board.currentFen
  );
}

/**
 * The start of the live analysis's top line (its best move alone before any line arrives), as
 * many moves as `plies`, as one string: a board redraws its arrows only when they change.
 */
export function liveTopLine(
  analysis: {
    topLines: readonly { multipv?: number; pv?: readonly string[] }[];
    bestMove: string | null;
  },
  plies: number
): string {
  const pv = analysis.topLines.find((line) => (line.multipv ?? 1) === 1)?.pv;
  const line = pv?.length ? pv : analysis.bestMove ? [analysis.bestMove] : [];
  return line.slice(0, Math.max(1, plies)).join(" ");
}

/**
 * The engine row's status while paused: the depth its lines reached on the paused position, else
 * the move that reached it (the lines shown are that position's).
 */
export function pausedStatusLabel(
  paused: PausedAnalysis,
  onPosition: boolean,
  depth: number | null | undefined
): string {
  if (onPosition) return depth ? `Paused at depth ${depth}` : "Paused";
  return `Paused · ${paused.move ? `after ${paused.move}` : "starting position"}`;
}
