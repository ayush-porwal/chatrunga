import { useCallback, useState } from "react";
import { createGameFromFen } from "@chaturanga/shared/chess/pgn";
import type { GameSession } from "@chaturanga/shared/types/chess";
import type { PuzzleSample, PuzzleSampleInput } from "@chaturanga/shared/types/database";
import type { PuzzleSessionConfig } from "../features/puzzles/PuzzlePage";
import { usePuzzleStore } from "../stores/puzzle-store";

/** The board a puzzle is played on: its start position, the solver's side at the bottom. */
export function puzzleBoard(puzzle: PuzzleSample): GameSession {
  return createGameFromFen({
    fen: puzzle.initialFen,
    source: "puzzle",
    headers: {
      event: puzzle.sourceName,
      site: puzzle.gameUrl ?? "?",
      white: "White",
      black: "Black",
      result: "*",
      orientationHint: puzzle.sideToMove
    }
  });
}

/** The request for the set's next puzzle (excluding those already shown), or null with no dataset chosen. */
export function nextPuzzleInput(config: PuzzleSessionConfig | null, shownIds: string[]): PuzzleSampleInput | null {
  if (!config?.databaseId) return null;
  return { databaseId: config.databaseId, excludeIds: shownIds, lichess: config.lichess, position: config.position };
}

/**
 * A puzzle set as a history entry keeps it: which set (each set started from the Puzzles page has
 * its own id), its filters and the puzzles shown by then.
 */
export type PuzzleSetSnapshot = { id: string; config: PuzzleSessionConfig; shownIds: string[] };

/** The set a puzzle starts: a new one (no id) or one history brings back (its id and the puzzles it had shown). */
export type PuzzleSetStart = { config: PuzzleSessionConfig; id?: string; shownIds?: string[] };

/** The puzzle set being played, as the session controller keeps it. */
export type PuzzleSessionState = {
  /** The set being played (null: none). */
  set: { id: string; config: PuzzleSessionConfig } | null;
  /**
   * The puzzles shown in each set played this run, by set id. Kept once a set ends, so a puzzle or
   * game history brings back goes on excluding every puzzle its set has shown, even after that entry.
   */
  shown: Record<string, string[]>;
  /** The game store's board played on from the set's puzzle (Play engine from here), or null. */
  continuationBoard: number | null;
};

export const NO_PUZZLE_SET: PuzzleSessionState = { set: null, shown: {}, continuationBoard: null };

/**
 * Whether the set goes on with the board now loaded (the game store's `board`): a game played on
 * from one of its puzzles (Play engine from here) is `continuationBoard`, and Next puzzle there
 * resumes the set.
 */
export function continuesPuzzleSet(
  config: PuzzleSessionConfig | null,
  continuationBoard: number | null,
  board: number
): boolean {
  return config !== null && continuationBoard !== null && continuationBoard === board;
}

function union(...lists: (readonly string[] | undefined)[]): string[] {
  return [...new Set(lists.flatMap((list) => list ?? []))];
}

/** `state` with `ids` added to set `id`'s shown puzzles. */
function withShown(state: PuzzleSessionState, id: string, ...ids: (readonly string[] | undefined)[]): Record<string, string[]> {
  return { ...state.shown, [id]: union(state.shown[id], ...ids) };
}

/** The puzzles the set being played has shown (the next one excludes them). */
export function shownInSet(state: PuzzleSessionState): string[] {
  return state.set ? (state.shown[state.set.id] ?? []) : [];
}

/** The set as a history entry records it, or null without one. */
export function snapshotPuzzleSet(state: PuzzleSessionState): PuzzleSetSnapshot | null {
  return state.set ? { ...state.set, shownIds: shownInSet(state) } : null;
}

/**
 * Puzzle `puzzleId` starts `start` (with its id: a new set's is made by the caller). The same set
 * again (history) keeps every puzzle it has shown; only a new set starts with this one alone.
 */
export function startPuzzleSet(
  state: PuzzleSessionState,
  puzzleId: string,
  start: PuzzleSetStart & { id: string }
): PuzzleSessionState {
  return {
    set: { id: start.id, config: start.config },
    shown: withShown(state, start.id, start.shownIds, [puzzleId]),
    continuationBoard: null
  };
}

/** Puzzle `puzzleId` joins the set being played (Next puzzle). */
export function joinPuzzleSet(state: PuzzleSessionState, puzzleId: string): PuzzleSessionState {
  return {
    ...state,
    shown: state.set ? withShown(state, state.set.id, [puzzleId]) : state.shown,
    continuationBoard: null
  };
}

/** `board` is a game played on from the set's puzzle just shown: the set goes on with it. */
export function continuePuzzleSet(state: PuzzleSessionState, board: number): PuzzleSessionState {
  return { ...state, continuationBoard: board };
}

/**
 * The set again for `board`, a game played on from its puzzle that history brought back (Back from
 * the set's next puzzle): Next puzzle there resumes it, still excluding every puzzle it has shown.
 */
export function resumePuzzleSet(state: PuzzleSessionState, set: PuzzleSetSnapshot, board: number): PuzzleSessionState {
  return {
    set: { id: set.id, config: set.config },
    shown: withShown(state, set.id, set.shownIds),
    continuationBoard: board
  };
}

/** No set is played any more (the puzzles each set showed stay, for history going back to it). */
export function endPuzzleSet(state: PuzzleSessionState): PuzzleSessionState {
  return { ...state, set: null, continuationBoard: null };
}

/**
 * The puzzle set being played: its filters and the puzzles shown so far (the next one excludes
 * them). `begin` records a puzzle the board now shows, `clear` ends the set. `continueOnBoard`
 * keeps the set (not the puzzle) for a game played on from its puzzle, `resumeOnBoard` brings it
 * back with that game (history); `release` ends the set unless the board is that game.
 */
export function usePuzzleSession() {
  const [state, setState] = useState<PuzzleSessionState>(NO_PUZZLE_SET);

  const clear = useCallback(() => {
    usePuzzleStore.getState().reset();
    setState(endPuzzleSet);
  }, []);

  /** `start` starts a set with this puzzle (a new one, or one history brings back); without it the puzzle joins the current set. */
  const begin = useCallback((puzzle: PuzzleSample, start?: PuzzleSetStart) => {
    usePuzzleStore.getState().setActivePuzzle(puzzle);
    // Made here, not in the updater: it may run twice.
    const started = start && { ...start, id: start.id ?? crypto.randomUUID() };
    setState((current) => (started ? startPuzzleSet(current, puzzle.id, started) : joinPuzzleSet(current, puzzle.id)));
  }, []);

  /**
   * `board` (the game store's) is a game played on from the puzzle just shown: the puzzle ends
   * (the board isn't one any more); the set and the puzzles shown stay for Next puzzle there.
   */
  const continueOnBoard = useCallback((board: number) => {
    usePuzzleStore.getState().reset();
    setState((current) => continuePuzzleSet(current, board));
  }, []);

  /** History brought back `board`, a game played on from `set`'s puzzle: the set goes on with it. */
  const resumeOnBoard = useCallback((set: PuzzleSetSnapshot, board: number) => {
    usePuzzleStore.getState().reset();
    setState((current) => resumePuzzleSet(current, set, board));
  }, []);

  const config = state.set?.config ?? null;
  /** Ends the set unless `board` is the game continued from it (shown again: Back, Game review). */
  const release = (board: number) => {
    if (!continuesPuzzleSet(config, state.continuationBoard, board)) clear();
  };

  return {
    config,
    shownIds: shownInSet(state),
    /** The set as a history entry records it (null without one). */
    snapshot: snapshotPuzzleSet(state),
    clear,
    begin,
    continueOnBoard,
    resumeOnBoard,
    release,
    continues: (board: number) => continuesPuzzleSet(config, state.continuationBoard, board)
  };
}
