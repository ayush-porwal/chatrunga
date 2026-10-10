import { useState } from "react";
import { useDeleteGameMutation } from "../../queries/api";
import { useAddToRepertoireStore } from "../../stores/add-to-repertoire-store";
import { useGameStore } from "../../stores/game-store";
import { useReviewStore } from "../../stores/review-store";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { cancelActiveReview } from "../../app/useReviewRunner";
import { hasMoves, sourceFromSavedGame } from "../repertoire/add-from-game";

/**
 * A library game's row actions, shared by the workspace's Library tab and Play's Recent games:
 * Delete (asks first; a game open on the board goes with it) and "Add to repertoire…" (reads the
 * saved game and opens the dialog without loading it). `error` is the last one's failure.
 */
export function useSavedGameActions() {
  const removeGame = useDeleteGameMutation();
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string): Promise<void> {
    if (!window.chaturanga) return;
    if (
      !window.confirm(
        "Remove this saved game? All moves, PGN, and any stored engine review for it will be deleted."
      )
    )
      return;
    setError(null);
    try {
      await removeGame.mutateAsync(id);
    } catch (reason) {
      // Still saved: the board keeps it.
      setError(`Couldn't delete that game: ${ipcErrorMessage(reason) || "unknown error"}`);
      return;
    }
    // Deleted while open: the board (and its review) go with it.
    if (useGameStore.getState().gameId === id) {
      void cancelActiveReview();
      useGameStore.getState().reset();
      useReviewStore.getState().reset();
    }
  }

  async function addToRepertoire(id: string): Promise<void> {
    setError(null);
    const saved = await window.chaturanga?.games.get(id).catch(() => null);
    if (!saved) {
      setError("Couldn't read that game.");
      return;
    }
    const source = sourceFromSavedGame(saved);
    if (!hasMoves(source.tree)) {
      setError("That game has no moves to add.");
      return;
    }
    useAddToRepertoireStore
      .getState()
      .open({ source, initialScope: { kind: "whole-game" }, entry: "library" });
  }

  return {
    remove,
    addToRepertoire,
    removing: removeGame.isPending,
    error,
    repertoiresAvailable: Boolean(window.chaturanga?.repertoires)
  };
}
