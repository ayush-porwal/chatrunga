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
  /** A search of a new position begins: the previous position's lines no longer apply. */
  startSearch: () => void;
  setInfo: (info: EngineInfo) => void;
  /** Apply a throttled batch of engine infos in one update (one render per batch). */
  setInfos: (infos: readonly EngineInfo[]) => void;
  setBestMove: (bestMove: string | null) => void;
  setError: (error: string | null) => void;
  reset: () => void;
};

function mergeInfos(
  topLines: readonly EngineInfo[],
  infos: readonly EngineInfo[]
): Pick<AnalysisStore, "latestInfo" | "topLines" | "status"> {
  const byLine = new Map(topLines.map((line) => [line.multipv ?? 1, line]));
  for (const info of infos) byLine.set(info.multipv ?? 1, info);
  const next = [...byLine.values()].sort((left, right) => (left.multipv ?? 1) - (right.multipv ?? 1));
  return { latestInfo: infos[infos.length - 1] ?? null, topLines: next, status: "thinking" };
}

export const useAnalysisStore = create<AnalysisStore>((set) => ({
  activeEngineId: null,
  status: "idle",
  latestInfo: null,
  topLines: [],
  bestMove: null,
  error: null,
  setActiveEngine: (activeEngineId) => set({ activeEngineId }),
  setStatus: (status) => set({ status }),
  startSearch: () => set({ status: "thinking", latestInfo: null, topLines: [], bestMove: null }),
  setInfo: (latestInfo) => set((state) => mergeInfos(state.topLines, [latestInfo])),
  setInfos: (infos) => {
    if (infos.length) set((state) => mergeInfos(state.topLines, infos));
  },
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
