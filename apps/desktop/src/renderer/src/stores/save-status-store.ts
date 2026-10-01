import { create } from "zustand";

/**
 * Whether a library write failed (the loaded game's, or one just left). Autosave owns it: set on
 * a failed save, cleared by the next successful save of that same game, and `retry` saves again now.
 */
type SaveStatusStore = {
  error: string | null;
  retry: (() => void) | null;
  /** The game whose save failed. */
  gameId: string | null;
  setFailed: (error: string, retry: () => void, gameId: string | null) => void;
  /** `gameId` was saved: clears the failure if it was that game's (another game's stays). */
  saved: (gameId: string | null) => void;
  clear: () => void;
};

export const useSaveStatusStore = create<SaveStatusStore>((set, get) => ({
  error: null,
  retry: null,
  gameId: null,
  setFailed: (error, retry, gameId) => set({ error, retry, gameId }),
  saved: (gameId) => {
    if (get().error !== null && get().gameId === gameId) get().clear();
  },
  clear: () => set({ error: null, retry: null, gameId: null })
}));
