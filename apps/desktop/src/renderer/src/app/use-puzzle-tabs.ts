import { useGameStore } from "../stores/game-store";
import { usePuzzleStore } from "../stores/puzzle-store";
import type { PuzzleTabs } from "./side-tabs";

/** The puzzle on the board, as the workspace's tabs see it (see PuzzleTabs). */
export function usePuzzleTabs(): PuzzleTabs {
  const puzzleBoard = useGameStore((state) => state.source === "puzzle");
  return usePuzzleStore((state) =>
    !puzzleBoard || !state.activePuzzle ? "none" : state.outcome === "pending" ? "locked" : "open"
  );
}
