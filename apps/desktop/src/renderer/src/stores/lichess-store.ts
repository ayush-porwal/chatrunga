import { create } from "zustand";
import type { Color } from "@chaturanga/shared/types/chess";
import type {
  LichessChallenge,
  LichessGameFull,
  LichessSeekInput,
  LichessStatus
} from "@chaturanga/shared/types/lichess";

export type PlayOpponent = "lichess" | "engine" | "board";

/** The Lichess game on the board: what the board and titlebar need beyond the moves and clocks. */
export type LiveLichessGame = {
  id: string;
  yourColor: Color;
  full: LichessGameFull;
  /** Side offering a draw right now, if any. */
  drawOffer: Color | null;
  /** The game stream is connected (false while the main process reconnects). */
  connected: boolean;
  /** The game has ended (the result is on the game store). */
  over: boolean;
};

type LichessStore = {
  status: LichessStatus;
  /** False until the first `lichess.status()` answer. */
  loaded: boolean;
  seek: { input: LichessSeekInput; startedAt: number } | null;
  seekError: string | null;
  challenges: LichessChallenge[];
  /** Games of yours in progress on Lichess that aren't on the board (to resume). */
  ongoingGameIds: string[];
  live: LiveLichessGame | null;
  sync: { running: boolean; imported: number; error: string | null };
  /** Opens a game of yours in progress on the board (set by the Lichess sync while it runs). */
  resumeGame: (gameId: string) => void;
  /** Play's opponent tab, kept for the session; null until chosen (Lichess when connected, else the engine). */
  playOpponent: PlayOpponent | null;
  setPlayOpponent: (opponent: PlayOpponent) => void;
  setStatus: (status: LichessStatus) => void;
  setSeek: (seek: LichessStore["seek"], error?: string | null) => void;
  setChallenges: (challenges: LichessChallenge[]) => void;
  upsertChallenge: (challenge: LichessChallenge) => void;
  removeChallenge: (challengeId: string) => void;
  setOngoingGameIds: (ids: string[]) => void;
  setLive: (live: LiveLichessGame | null) => void;
  patchLive: (patch: Partial<LiveLichessGame>) => void;
  setSync: (sync: LichessStore["sync"]) => void;
};

export const useLichessStore = create<LichessStore>((set) => ({
  status: { account: null, connecting: false, tokenRejected: false },
  loaded: false,
  seek: null,
  seekError: null,
  challenges: [],
  ongoingGameIds: [],
  live: null,
  sync: { running: false, imported: 0, error: null },
  resumeGame: () => undefined,
  playOpponent: null,
  setPlayOpponent: (playOpponent) => set({ playOpponent }),
  setStatus: (status) =>
    set(() => ({
      status,
      loaded: true,
      // Signed out: nothing account-bound survives.
      ...(status.account ? {} : { seek: null, challenges: [], ongoingGameIds: [] })
    })),
  setSeek: (seek, error = null) => set({ seek, seekError: error }),
  setChallenges: (challenges) => set({ challenges }),
  upsertChallenge: (challenge) =>
    set((state) => ({
      challenges: [...state.challenges.filter((item) => item.id !== challenge.id), challenge]
    })),
  removeChallenge: (challengeId) =>
    set((state) => ({ challenges: state.challenges.filter((item) => item.id !== challengeId) })),
  setOngoingGameIds: (ids) => set({ ongoingGameIds: ids }),
  setLive: (live) => set({ live }),
  patchLive: (patch) => set((state) => (state.live ? { live: { ...state.live, ...patch } } : {})),
  setSync: (sync) => set({ sync })
}));

/** A Lichess game is being played on the board: engines stay off and the board can't be swapped. */
export const selectLiveGameInProgress = (state: LichessStore) =>
  Boolean(state.live && !state.live.over);
