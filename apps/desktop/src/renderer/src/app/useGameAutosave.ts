import { useEffect } from "react";
import { statusForFen } from "@chaturanga/shared/chess/position";
import { useSaveGameMutation } from "../queries/api";
import { useGameStore } from "../stores/game-store";
import { usePuzzleStore } from "../stores/puzzle-store";
import { useReviewStore } from "../stores/review-store";

/** Quiet period after the last change before the game is written to the library. */
export const AUTOSAVE_DELAY_MS = 600;

/**
 * Saves the loaded game (moves, cursor, result and review) to the library shortly after it
 * changes. New empty boards and puzzle practice are never saved.
 */
export function useGameAutosave(): void {
  const saveGame = useSaveGameMutation().mutate;
  const currentNodeId = useGameStore((state) => state.currentNodeId);
  const moveTree = useGameStore((state) => state.moveTree);
  const mode = useGameStore((state) => state.mode);
  const gameOutcome = useGameStore((state) => state.gameOutcome);
  const activePuzzle = usePuzzleStore((state) => state.activePuzzle);
  const review = useReviewStore((state) => state.review);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const game = useGameStore.getState();
      // Puzzle practice is ephemeral: never persist it as a "saved game" / recent entry.
      if (game.mode === "puzzle" && usePuzzleStore.getState().activePuzzle) return;
      const session = game.toSession();
      if (session.moveTree.length <= 1 && !session.id) return;
      saveGame(
        {
          id: session.id,
          source: session.source,
          headers: { ...session.headers, result: game.gameOutcome?.result ?? statusForFen(session.currentFen).result },
          rootFen: session.rootFen,
          currentFen: session.currentFen,
          currentNodeId: session.currentNodeId,
          pgn: session.pgn,
          moveTree: session.moveTree,
          review: useReviewStore.getState().review
        },
        { onSuccess: (saved) => useGameStore.getState().setGameId(saved.id) }
      );
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [activePuzzle, currentNodeId, gameOutcome, mode, moveTree, review, saveGame]);
}
