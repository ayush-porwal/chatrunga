import type { AddFromGameSource } from "@chaturanga/shared/types/repertoire";
import { flushGameAutosave } from "../../app/useGameAutosave";
import { useGameStore } from "../../stores/game-store";
import { sourceFromBoard } from "./add-from-game";

/** Shown when the board's game couldn't be saved before adding it to a repertoire. */
export const ADD_NEEDS_SAVE =
  "Couldn't save the current game first, so it can't be added yet. Try again.";

/**
 * The board's game as an "Add to repertoire" source, after writing its pending autosave: a game
 * played moments ago is then linked by its library id rather than as a board that was never saved.
 * Null when that save failed (the link would name a game the library doesn't have).
 */
export async function captureBoardSource(): Promise<AddFromGameSource | null> {
  if (!(await flushGameAutosave())) return null;
  return sourceFromBoard(useGameStore.getState());
}
