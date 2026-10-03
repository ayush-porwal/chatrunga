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
 * The puzzle set being played: its filters and the puzzles shown so far (the next one excludes
 * them). `begin` records a puzzle the board now shows, `clear` ends the set.
 */
export function usePuzzleSession() {
  const [config, setConfig] = useState<PuzzleSessionConfig | null>(null);
  const [shownIds, setShownIds] = useState<string[]>([]);

  const clear = useCallback(() => {
    usePuzzleStore.getState().reset();
    setConfig(null);
    setShownIds([]);
  }, []);

  /** `nextConfig` starts a new set with this puzzle; without it the puzzle joins the current set. */
  const begin = useCallback((puzzle: PuzzleSample, nextConfig?: PuzzleSessionConfig) => {
    usePuzzleStore.getState().setActivePuzzle(puzzle);
    if (nextConfig) {
      setConfig(nextConfig);
      setShownIds([puzzle.id]);
    } else {
      setShownIds((ids) => (ids.includes(puzzle.id) ? ids : [...ids, puzzle.id]));
    }
  }, []);

  return { config, shownIds, clear, begin };
}
