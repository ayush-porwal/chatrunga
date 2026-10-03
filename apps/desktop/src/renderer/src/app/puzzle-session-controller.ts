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

/**
 * The puzzle set being played: its filters and the puzzles shown so far (the next one excludes
 * them). `begin` records a puzzle the board now shows, `clear` ends the set. `continueOnBoard`
 * keeps the set (not the puzzle) for a game played on from its puzzle; `release` ends the set
 * unless the board is that game.
 */
export function usePuzzleSession() {
  const [config, setConfig] = useState<PuzzleSessionConfig | null>(null);
  const [shownIds, setShownIds] = useState<string[]>([]);
  const [continuationBoard, setContinuationBoard] = useState<number | null>(null);

  const clear = useCallback(() => {
    usePuzzleStore.getState().reset();
    setConfig(null);
    setShownIds([]);
    setContinuationBoard(null);
  }, []);

  /** `nextConfig` starts a new set with this puzzle; without it the puzzle joins the current set. */
  const begin = useCallback((puzzle: PuzzleSample, nextConfig?: PuzzleSessionConfig) => {
    usePuzzleStore.getState().setActivePuzzle(puzzle);
    setContinuationBoard(null);
    if (nextConfig) {
      setConfig(nextConfig);
      setShownIds([puzzle.id]);
    } else {
      setShownIds((ids) => (ids.includes(puzzle.id) ? ids : [...ids, puzzle.id]));
    }
  }, []);

  /**
   * `board` (the game store's) is a game played on from the puzzle just shown: the puzzle ends
   * (the board isn't one any more); the set and the puzzles shown stay for Next puzzle there.
   */
  const continueOnBoard = useCallback((board: number) => {
    usePuzzleStore.getState().reset();
    setContinuationBoard(board);
  }, []);

  /** Ends the set unless `board` is the game continued from it (shown again: Back, Game review). */
  const release = (board: number) => {
    if (!continuesPuzzleSet(config, continuationBoard, board)) clear();
  };

  return {
    config,
    shownIds,
    clear,
    begin,
    continueOnBoard,
    release,
    continues: (board: number) => continuesPuzzleSet(config, continuationBoard, board)
  };
}
