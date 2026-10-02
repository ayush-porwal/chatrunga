import { create } from "zustand";
import type { EngineInfo, EngineStatus } from "@chaturanga/shared/types/engine";

type AnalysisStore = {
  /** The engine running now (live analysis, or the opponent in an engine game). */
  activeEngineId: string | null;
  status: EngineStatus;
  latestInfo: EngineInfo | null;
  topLines: EngineInfo[];
  bestMove: string | null;
  error: string | null;
  setActiveEngine: (engineId: string | null) => void;
  setStatus: (status: EngineStatus) => void;
  /**
   * A search begins: the previous position's lines no longer apply. With `resultKey` (position,
   * engine and line count), the deepest lines already found for it show at once, and the new
   * search replaces each one only when it gets as deep (stopping and starting again, or coming back
   * to a position, carries on from there instead of counting up from depth 1).
   */
  startSearch: (resultKey?: string | null) => void;
  /** The key the running search's lines are remembered under (see startSearch). */
  resultKey: string | null;
  /** Search the current position again from scratch, forgetting what was found for it. */
  restartFresh: () => void;
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

/** Deepest lines found per result key this session; the oldest go past the limit. */
const RESULT_CACHE_LIMIT = 300;
const results = new Map<string, EngineInfo[]>();

function remember(key: string | null, lines: EngineInfo[]): void {
  if (!key || !lines.length) return;
  results.delete(key);
  results.set(key, lines);
  if (results.size > RESULT_CACHE_LIMIT) results.delete(results.keys().next().value!);
}

/** Test-only: forget every remembered result. */
export function clearAnalysisResults(): void {
  results.clear();
}

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
    // A line remembered from an earlier search stays until this search gets as deep.
    const earlier = previous && previous.searchId !== info.searchId;
    if (earlier && (info.depth ?? 0) < (previous.depth ?? 0)) continue;
    byLine.set(key, previous ? { ...previous, ...info } : info);
  }
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
  startSearch: (resultKey = null) =>
    set({ status: "thinking", latestInfo: null, topLines: resultKey ? (results.get(resultKey) ?? []) : [], bestMove: null, resultKey }),
  resultKey: null,
  searchEpoch: 0,
  restartSearch: () => set((state) => ({ searchEpoch: state.searchEpoch + 1 })),
  restartFresh: () =>
    set((state) => {
      if (state.resultKey) results.delete(state.resultKey);
      return { topLines: [], latestInfo: null, bestMove: null, searchEpoch: state.searchEpoch + 1 };
    }),
  setInfo: (latestInfo) =>
    set((state) => {
      const next = mergeInfos(state.topLines, [latestInfo]);
      remember(state.resultKey, next.topLines);
      return next;
    }),
  setInfos: (infos) => {
    if (!infos.length) return;
    set((state) => {
      const next = mergeInfos(state.topLines, infos);
      remember(state.resultKey, next.topLines);
      return next;
    });
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
      error: null,
      resultKey: null
    })
}));
