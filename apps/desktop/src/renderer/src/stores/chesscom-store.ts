import { create } from "zustand";
import type { ChesscomStatus } from "@chaturanga/shared/types/chesscom";

type ChesscomStore = {
  status: ChesscomStatus;
  /** False until the first `chesscom.status()` answer. */
  loaded: boolean;
  sync: { running: boolean; imported: number; error: string | null };
  setStatus: (status: ChesscomStatus) => void;
  setSync: (sync: ChesscomStore["sync"]) => void;
};

/** The chess.com account and its import, as the main process reports them (app/useChesscom.ts). */
export const useChesscomStore = create<ChesscomStore>((set) => ({
  status: { account: null, connecting: false },
  loaded: false,
  sync: { running: false, imported: 0, error: null },
  setStatus: (status) => set({ status, loaded: true }),
  setSync: (sync) => set({ sync })
}));
