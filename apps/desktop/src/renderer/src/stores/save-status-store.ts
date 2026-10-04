import { create } from "zustand";

/** A game whose last save failed, and what saves it again. */
type SaveFailure = {
  gameId: string | null;
  error: string;
  retry: () => void;
  /** The write that failed (see `setFailed`). */
  revision: number;
};

/**
 * Library writes that failed (the loaded game's, or games left), one per game. Autosave owns it:
 * set on a failed save, cleared by a newer successful save of that same game, and `retry` saves
 * every one of them again now.
 */
type SaveStatusStore = {
  failures: readonly SaveFailure[];
  /** The most recent failure's message; null once every game is saved. */
  error: string | null;
  /**
   * Write `revision` of `gameId` failed. Revisions count up with every write, so a write that
   * settles after a newer one of the same game did is out of date and changes nothing.
   */
  setFailed: (error: string, retry: () => void, gameId: string | null, revision: number) => void;
  /** Write `revision` of `gameId` was saved: clears that game's failure, unless it's newer. */
  saved: (gameId: string | null, revision: number) => void;
  retry: () => void;
  clear: () => void;
};

export const useSaveStatusStore = create<SaveStatusStore>((set, get) => {
  // The newest write that settled, per game.
  const settled = new Map<string | null, number>();
  const settle = (gameId: string | null, revision: number) => {
    if (revision < (settled.get(gameId) ?? -Infinity)) return false;
    settled.set(gameId, revision);
    return true;
  };
  const setFailures = (failures: SaveFailure[]) =>
    set({ failures, error: failures.at(-1)?.error ?? null });
  const without = (gameId: string | null) =>
    get().failures.filter((failure) => failure.gameId !== gameId);

  return {
    failures: [],
    error: null,
    setFailed: (error, retry, gameId, revision) => {
      if (settle(gameId, revision))
        setFailures([...without(gameId), { gameId, error, retry, revision }]);
    },
    saved: (gameId, revision) => {
      if (!settle(gameId, revision) || !get().failures.some((failure) => failure.gameId === gameId))
        return;
      setFailures(without(gameId));
    },
    retry: () => get().failures.forEach((failure) => failure.retry()),
    clear: () => {
      settled.clear();
      setFailures([]);
    }
  };
});
