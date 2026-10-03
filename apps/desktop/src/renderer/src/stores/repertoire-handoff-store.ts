import { create } from "zustand";
import type { Color } from "@chaturanga/shared/types/chess";

/**
 * The engine game started from a repertoire (Play from here) and where it came from: the return
 * target, the colour for "Review opening" and the provenance link to write once the game has a
 * library id. One at a time; starting another replaces it, but a replaced game whose first save
 * hasn't bound it yet is kept (by its board) until that save, so its link is still written. Never
 * touches the repertoire itself.
 */
export type PlayedHandoff = {
  repertoireId: string;
  chapterId: string;
  nodeId: string;
  capturedPath: string;
  /** The game's node at the handoff position (the end of the replayed prefix). */
  gameNodeId: string;
  color: Color;
  /** The game store's `board` the game was loaded as, to match its first save. */
  board: number;
  /** The game's library id once its first save succeeded. */
  gameId: string | null;
  /** The game is still the board it started on (false once another board replaced it). */
  onBoard: boolean;
};

/** Replaced handoffs still waiting for their first save (a game never saved stays unlinked). */
const MAX_EARLIER = 8;

type RepertoireHandoffStore = {
  played: PlayedHandoff | null;
  /** Replaced handoffs whose first save hasn't bound them yet, newest first. */
  earlier: PlayedHandoff[];
  begin: (handoff: Omit<PlayedHandoff, "gameId" | "onBoard">) => void;
  /**
   * Binds the handoff a save matched (see `handoffForSave`) to the library id it wrote; a replaced
   * one is then done with (its link is written) and dropped.
   */
  bindGame: (gameId: string, board?: number) => void;
  leaveBoard: () => void;
};

export const useRepertoireHandoffStore = create<RepertoireHandoffStore>((set) => ({
  played: null,
  earlier: [],
  begin: (handoff) =>
    set((state) => ({
      played: { ...handoff, gameId: null, onBoard: true },
      earlier:
        state.played && state.played.gameId === null
          ? [{ ...state.played, onBoard: false }, ...state.earlier].slice(0, MAX_EARLIER)
          : state.earlier
    })),
  bindGame: (gameId, board) =>
    set((state) => {
      if (board !== undefined && state.earlier.some((item) => item.board === board)) {
        return { earlier: state.earlier.filter((item) => item.board !== board) };
      }
      return state.played && !state.played.gameId ? { played: { ...state.played, gameId } } : {};
    }),
  leaveBoard: () =>
    set((state) => (state.played?.onBoard ? { played: { ...state.played, onBoard: false } } : {}))
}));

/**
 * Whether the game on the board is the handoff's: still the board it started on, or the saved game
 * reopened later (same library id).
 */
export function isHandoffGame(played: PlayedHandoff | null, gameId: string | null): boolean {
  return Boolean(
    played && (played.onBoard || (played.gameId !== null && played.gameId === gameId))
  );
}

/**
 * Whether a library write saved the handoff's game: its id once bound, or before that the board it
 * was loaded as (a first save can land after another board replaced it).
 */
export function isHandoffSave(
  played: PlayedHandoff | null,
  saved: { gameId: string; board: number }
): boolean {
  if (!played) return false;
  return played.gameId !== null ? played.gameId === saved.gameId : played.board === saved.board;
}

/**
 * The handoff a library write saved: the current one, or a replaced one still waiting for its
 * first save (a second Play from here can start before the first game's save is answered).
 */
export function handoffForSave(
  state: Pick<RepertoireHandoffStore, "played" | "earlier">,
  saved: { gameId: string; board: number }
): PlayedHandoff | null {
  if (isHandoffSave(state.played, saved)) return state.played;
  return state.earlier.find((item) => item.board === saved.board) ?? null;
}
