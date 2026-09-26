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

  // Subscribes to the stores directly (no React state), so a move or a review update does not
  // re-render the app shell that mounts this hook.
  useEffect(() => {
    let timeout = 0;
    const save = () => {
      const game = useGameStore.getState();
      // Puzzle practice is ephemeral: never persist it as a "saved game" / recent entry.
      if (game.mode === "puzzle" && usePuzzleStore.getState().activePuzzle) return;
      const session = game.toSession();
      if (session.moveTree.length <= 1 && !session.id) return;
      saveGame(
        {
          id: session.id,
          source: session.source,
          headers: { ...session.headers, result: savedResult(game.gameOutcome?.result, statusForFen(session.currentFen).result, session.headers.result) },
          rootFen: session.rootFen,
          currentFen: session.currentFen,
          currentNodeId: session.currentNodeId,
          pgn: session.pgn,
          moveTree: session.moveTree,
          review: useReviewStore.getState().review
        },
        { onSuccess: (saved) => useGameStore.getState().setGameId(saved.id) }
      );
    };
    const schedule = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(save, AUTOSAVE_DELAY_MS);
    };
    const unsubscribers = [
      useGameStore.subscribe((state, previous) => {
        if (
          state.currentNodeId !== previous.currentNodeId ||
          state.moveTree !== previous.moveTree ||
          state.mode !== previous.mode ||
          state.gameOutcome !== previous.gameOutcome
        ) {
          schedule();
        }
      }),
      usePuzzleStore.subscribe((state, previous) => {
        if (state.activePuzzle !== previous.activePuzzle) schedule();
      }),
      useReviewStore.subscribe((state, previous) => {
        if (state.review !== previous.review) schedule();
      })
    ];
    return () => {
      window.clearTimeout(timeout);
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [saveGame]);
}

/**
 * The result to save: a finished game on the board (outcome or a terminal position) wins; on a
 * position mid-game the game's own recorded result stands, so stepping back through an imported,
 * decided game (e.g. reviewing it from move 16) doesn't turn it into a game "in progress".
 */
export function savedResult(outcome: string | undefined, positionResult: string, headerResult: string | null | undefined): string {
  if (outcome) return outcome;
  if (positionResult !== "*") return positionResult;
  return headerResult || "*";
}
