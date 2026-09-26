import { useEffect } from "react";
import { statusForFen } from "@chaturanga/shared/chess/position";
import type { MoveNode } from "@chaturanga/shared/types/chess";
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
    // The mainline end the loaded game's recorded result belongs to (see savedResult).
    let resultAnchor = mainlineEnd(useGameStore.getState().moveTree)?.id ?? null;
    const save = () => {
      const game = useGameStore.getState();
      // Puzzle practice is ephemeral: never persist it as a "saved game" / recent entry.
      if (game.mode === "puzzle" && usePuzzleStore.getState().activePuzzle) return;
      const session = game.toSession();
      if (session.moveTree.length <= 1 && !session.id) return;
      const end = mainlineEnd(session.moveTree);
      const result = savedResult(
        game.gameOutcome?.result,
        statusForFen(end?.fenAfter ?? session.currentFen).result,
        session.headers.result,
        end?.id === resultAnchor
      );
      saveGame(
        {
          id: session.id,
          source: session.source,
          headers: { ...session.headers, result },
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
        // Loading a game or resetting the board replaces headers and move tree together (moves
        // change only the tree, outcomes/header edits only the headers): new recorded result.
        if (state.headers !== previous.headers && state.moveTree !== previous.moveTree) {
          resultAnchor = mainlineEnd(state.moveTree)?.id ?? null;
        }
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

/** Last node of the main line (first child at every step from the root). */
export function mainlineEnd(moveTree: readonly MoveNode[]): MoveNode | null {
  const byId = new Map(moveTree.map((node) => [node.id, node]));
  let node = moveTree.find((item) => item.parentId === null) ?? null;
  while (node?.children[0] && byId.has(node.children[0])) node = byId.get(node.children[0])!;
  return node;
}

/**
 * The result to save. It belongs to the game, not the cursor: a live outcome wins, then a
 * terminal position at the end of the main line. Otherwise the game's recorded result stands only
 * while the main line still ends where it did when the game was loaded — so stepping back through
 * a decided game keeps "1-0", but deleting or adding final moves makes it a game in progress.
 */
export function savedResult(
  outcome: string | undefined,
  mainlineEndResult: string,
  headerResult: string | null | undefined,
  mainlineUnchanged: boolean
): string {
  if (outcome) return outcome;
  if (mainlineEndResult !== "*") return mainlineEndResult;
  return (mainlineUnchanged && headerResult) || "*";
}
