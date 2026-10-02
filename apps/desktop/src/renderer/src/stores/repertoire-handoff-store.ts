import { create } from "zustand";
import type { Color } from "@chaturanga/shared/types/chess";

/**
 * The engine game started from a repertoire (Play from here) and where it came from: the return
 * target, the colour for "Review opening" and the provenance link to write once the game has a
 * library id. One at a time; starting another replaces it. Never touches the repertoire itself.
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

type RepertoireHandoffStore = {
  played: PlayedHandoff | null;
  begin: (handoff: Omit<PlayedHandoff, "gameId" | "onBoard">) => void;
  bindGame: (gameId: string) => void;
  leaveBoard: () => void;
};

export const useRepertoireHandoffStore = create<RepertoireHandoffStore>((set) => ({
  played: null,
  begin: (handoff) => set({ played: { ...handoff, gameId: null, onBoard: true } }),
  bindGame: (gameId) =>
    set((state) =>
      state.played && !state.played.gameId ? { played: { ...state.played, gameId } } : {}
    ),
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
