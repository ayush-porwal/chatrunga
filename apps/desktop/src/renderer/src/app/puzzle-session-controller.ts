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

/** A puzzle set as a history entry keeps it: its filters and the puzzles shown by then. */
export type PuzzleSetSnapshot = { config: PuzzleSessionConfig; shownIds: string[] };

/** The puzzle set being played, as the session controller keeps it. */
export type PuzzleSessionState = {
  /** The set's filters (null: no set). */
  config: PuzzleSessionConfig | null;
  /** The puzzles shown in the set (the next one excludes them). */
  shownIds: string[];
  /** The game store's board played on from the set's puzzle (Play engine from here), or null. */
  continuationBoard: number | null;
};

export const NO_PUZZLE_SET: PuzzleSessionState = { config: null, shownIds: [], continuationBoard: null };

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

/** The set as a history entry records it, or null without one. */
export function snapshotPuzzleSet(state: PuzzleSessionState): PuzzleSetSnapshot | null {
  return state.config ? { config: state.config, shownIds: state.shownIds } : null;
}

/**
 * The set again for `board`, a game played on from its puzzle that history brought back (Back from
 * the set's next puzzle): Next puzzle there resumes it.
 */
export function resumePuzzleSet(set: PuzzleSetSnapshot, board: number): PuzzleSessionState {
  return { config: set.config, shownIds: set.shownIds, continuationBoard: board };
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
    setState(NO_PUZZLE_SET);
  }, []);

  /** `nextConfig` starts a new set with this puzzle; without it the puzzle joins the current set. */
  const begin = useCallback((puzzle: PuzzleSample, nextConfig?: PuzzleSessionConfig) => {
    usePuzzleStore.getState().setActivePuzzle(puzzle);
    setState((current) =>
      nextConfig
        ? { config: nextConfig, shownIds: [puzzle.id], continuationBoard: null }
        : {
            ...current,
            shownIds: current.shownIds.includes(puzzle.id) ? current.shownIds : [...current.shownIds, puzzle.id],
            continuationBoard: null
          }
    );
  }, []);

  /**
   * `board` (the game store's) is a game played on from the puzzle just shown: the puzzle ends
   * (the board isn't one any more); the set and the puzzles shown stay for Next puzzle there.
   */
  const continueOnBoard = useCallback((board: number) => {
    usePuzzleStore.getState().reset();
    setState((current) => ({ ...current, continuationBoard: board }));
  }, []);

  /** History brought back `board`, a game played on from `set`'s puzzle: the set goes on with it. */
  const resumeOnBoard = useCallback((set: PuzzleSetSnapshot, board: number) => {
    usePuzzleStore.getState().reset();
    setState(resumePuzzleSet(set, board));
  }, []);

  /** Ends the set unless `board` is the game continued from it (shown again: Back, Game review). */
  const release = (board: number) => {
    if (!continuesPuzzleSet(state.config, state.continuationBoard, board)) clear();
  };

  return {
    config: state.config,
    shownIds: state.shownIds,
    /** The set as a history entry records it (null without one). */
    snapshot: snapshotPuzzleSet(state),
    clear,
    begin,
    continueOnBoard,
    resumeOnBoard,
    release,
    continues: (board: number) => continuesPuzzleSet(state.config, state.continuationBoard, board)
  };
}
