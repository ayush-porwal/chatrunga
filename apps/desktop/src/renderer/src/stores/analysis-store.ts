import { create } from "zustand";
import type { EngineInfo, EngineStatus } from "@chaturanga/shared/types/engine";

type AnalysisStore = {
  activeEngineId: string | null;
  status: EngineStatus;
  latestInfo: EngineInfo | null;
  topLines: EngineInfo[];
  bestMove: string | null;
  error: string | null;
  setActiveEngine: (engineId: string | null) => void;
  setStatus: (status: EngineStatus) => void;
  setInfo: (info: EngineInfo) => void;
  setBestMove: (bestMove: string | null) => void;
  setError: (error: string | null) => void;
  reset: () => void;
};

export const useAnalysisStore = create<AnalysisStore>((set) => ({
  activeEngineId: null,
  status: "idle",
  latestInfo: null,
  topLines: [],
  bestMove: null,
  error: null,
  setActiveEngine: (activeEngineId) => set({ activeEngineId }),
  setStatus: (status) => set({ status }),
  setInfo: (latestInfo) =>
    set((state) => {
      const multipv = latestInfo.multipv ?? 1;
      const next = state.topLines
        .filter((line) => (line.multipv ?? 1) !== multipv)
        .concat(latestInfo)
        .sort((left, right) => (left.multipv ?? 1) - (right.multipv ?? 1));
      return { latestInfo, topLines: next, status: "thinking" };
    }),
  setBestMove: (bestMove) => set({ bestMove, status: "ready" }),
  setError: (error) => set({ error, status: "error" }),
  reset: () =>
    set({
      activeEngineId: null,
      status: "idle",
      latestInfo: null,
      topLines: [],
      bestMove: null,
      error: null
    })
}));
