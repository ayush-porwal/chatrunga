import { create } from "zustand";
import type { EngineInfo, EngineStatus } from "@chaturanga/shared/types/engine";

type AnalysisStore = {
  /** The engine running now (live analysis, or the opponent in an engine game). */
  activeEngineId: string | null;
  /**
   * The engine the user chose for live analysis (null: the default engine). Kept across boards and
   * resets; an engine that's gone falls back to the default (see analysisEngineFor).
   */
  analysisEngineId: string | null;
  /** Analyse with `engineId` from now on (a running analysis restarts with it). */
  chooseAnalysisEngine: (engineId: string | null) => void;
  status: EngineStatus;
  latestInfo: EngineInfo | null;
  topLines: EngineInfo[];
  bestMove: string | null;
  error: string | null;
  setActiveEngine: (engineId: string | null) => void;
  setStatus: (status: EngineStatus) => void;
  /** A search of a new position begins: the previous position's lines no longer apply. */
  startSearch: () => void;
  /**
   * Bumped to make live analysis search again even though the position didn't change (the
   * search was stopped while away, e.g. Back to an analysis board, or Analyze on the same position).
   */
  searchEpoch: number;
  restartSearch: () => void;
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
  // Only a scored line replaces a line: progress reports (`info depth 33 currmove …`, `info nodes … nps …`)
  // carry no score or moves, and the last one before a stop used to blank line 1, Score and Best.
  for (const info of infos) {
    if (!info.score && !info.pv?.length) continue;
    const key = info.multipv ?? 1;
    // Some engines send the score and the moves of a line in separate infos: an update keeps what
    // it doesn't carry (the parser only sets the fields an info has).
    const previous = byLine.get(key);
    byLine.set(key, previous ? { ...previous, ...info } : info);
  }
  const next = [...byLine.values()].sort((left, right) => (left.multipv ?? 1) - (right.multipv ?? 1));
  return { latestInfo: infos[infos.length - 1] ?? null, topLines: next, status: "thinking" };
}

export const useAnalysisStore = create<AnalysisStore>((set) => ({
  activeEngineId: null,
  analysisEngineId: null,
  chooseAnalysisEngine: (analysisEngineId) =>
    set((state) => ({ analysisEngineId, searchEpoch: state.searchEpoch + 1 })),
  status: "idle",
  latestInfo: null,
  topLines: [],
  bestMove: null,
  error: null,
  setActiveEngine: (activeEngineId) => set({ activeEngineId }),
  setStatus: (status) => set({ status }),
  startSearch: () => set({ status: "thinking", latestInfo: null, topLines: [], bestMove: null }),
  searchEpoch: 0,
  restartSearch: () => set((state) => ({ searchEpoch: state.searchEpoch + 1 })),
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
