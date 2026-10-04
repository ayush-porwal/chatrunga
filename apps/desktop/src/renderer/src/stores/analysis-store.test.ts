import { beforeEach, describe, expect, it } from "vitest";
import { clearAnalysisResults, useAnalysisStore } from "./analysis-store";
import type { EngineInfo } from "@chaturanga/shared/types/engine";

function info(multipv: number, value: number): EngineInfo {
  return {
    engineId: "engine-1",
    multipv,
    score: { type: "cp", value },
    pv: [],
    raw: `info multipv ${multipv}`,
    receivedAt: value
  };
}

describe("analysis store", () => {
  beforeEach(() => {
    useAnalysisStore.getState().reset();
  });

  it("keeps MultiPV lines sorted and replaces updated lines", () => {
    useAnalysisStore.getState().setInfo(info(2, 20));
    useAnalysisStore.getState().setInfo(info(1, 10));
    useAnalysisStore.getState().setInfo(info(2, 30));

    const state = useAnalysisStore.getState();
    expect(state.status).toBe("thinking");
    expect(state.latestInfo?.score?.value).toBe(30);
    expect(state.topLines.map((line) => [line.multipv, line.score?.value])).toEqual([
      [1, 10],
      [2, 30]
    ]);
  });

  it("applies a batch of infos as one update, last info per line winning", () => {
    let updates = 0;
    const unsubscribe = useAnalysisStore.subscribe(() => (updates += 1));
    useAnalysisStore.getState().setInfos([info(1, 10), info(2, 20), info(1, 15), info(3, 5)]);
    unsubscribe();
    const state = useAnalysisStore.getState();
    expect(updates).toBe(1);
    expect(state.latestInfo?.multipv).toBe(3);
    expect(state.topLines.map((line) => [line.multipv, line.score?.value])).toEqual([
      [1, 15],
      [2, 20],
      [3, 5]
    ]);
    useAnalysisStore.getState().setInfos([]);
    expect(useAnalysisStore.getState()).toBe(state);
  });

  it("progress reports without a score or moves don't blank the lines (the last one before a stop)", () => {
    useAnalysisStore.getState().setInfos([info(1, 40), info(2, 25)]);
    useAnalysisStore.getState().setInfos([
      {
        engineId: "engine-1",
        depth: 33,
        raw: "info depth 33 currmove e2e4 currmovenumber 1",
        receivedAt: 50
      },
      {
        engineId: "engine-1",
        nodes: 1_000_000,
        nps: 900_000,
        raw: "info nodes 1000000 nps 900000",
        receivedAt: 51
      }
    ]);
    const { topLines } = useAnalysisStore.getState();
    expect(topLines.map((line) => line.score?.value)).toEqual([40, 25]);
  });

  it("merges a line's score and moves sent in separate infos", () => {
    const base = { engineId: "engine-1", multipv: 1, raw: "info", receivedAt: 1 };
    useAnalysisStore
      .getState()
      .setInfos([{ ...base, score: { type: "cp", value: 30 }, pv: ["e2e4", "e7e5"] }]);
    useAnalysisStore.getState().setInfos([{ ...base, pv: ["d2d4"] }]);
    expect(useAnalysisStore.getState().topLines[0]).toMatchObject({
      score: { value: 30 },
      pv: ["d2d4"]
    });
    useAnalysisStore.getState().setInfos([{ ...base, score: { type: "cp", value: 12 } }]);
    expect(useAnalysisStore.getState().topLines[0]).toMatchObject({
      score: { value: 12 },
      pv: ["d2d4"]
    });
  });

  it("starting a position's search again carries on from the deepest lines found for it", () => {
    clearAnalysisResults();
    const line = (searchId: string, depth: number, value: number) => ({
      engineId: "engine-1",
      searchId,
      multipv: 1,
      depth,
      score: { type: "cp" as const, value },
      pv: ["e2e4"],
      raw: "info",
      receivedAt: depth
    });
    const store = useAnalysisStore.getState();
    store.startSearch("fen|sf|1", "first");
    store.setInfos([line("first", 28, 30)]);
    // Stopped, then started again: the depth-28 line shows at once, not an empty panel.
    useAnalysisStore.getState().startSearch("fen|sf|1", "second");
    expect(useAnalysisStore.getState().topLines[0]).toMatchObject({
      depth: 28,
      score: { value: 30 }
    });
    // The new search's shallow lines don't replace it; one as deep does.
    useAnalysisStore.getState().setInfos([line("second", 5, -80)]);
    expect(useAnalysisStore.getState().topLines[0]?.depth).toBe(28);
    useAnalysisStore.getState().setInfos([line("second", 29, 25)]);
    expect(useAnalysisStore.getState().topLines[0]).toMatchObject({
      depth: 29,
      score: { value: 25 }
    });
    // Another position starts empty; Restart forgets what was found.
    useAnalysisStore.getState().startSearch("other|sf|1");
    expect(useAnalysisStore.getState().topLines).toEqual([]);
    useAnalysisStore.getState().startSearch("fen|sf|1", "third");
    useAnalysisStore.getState().restartFresh();
    useAnalysisStore.getState().startSearch("fen|sf|1", "fourth");
    expect(useAnalysisStore.getState().topLines).toEqual([]);
  });

  it("never remembers another search's lines under an analysis position (an engine game's)", () => {
    clearAnalysisResults();
    const info = (searchId: string) => ({
      engineId: "sf",
      searchId,
      multipv: 1,
      depth: 20,
      score: { type: "cp" as const, value: 5 },
      pv: ["e2e4"],
      raw: "",
      receivedAt: 0
    });
    useAnalysisStore.getState().startSearch("pos|sf|1", "analysis");
    useAnalysisStore.getState().setInfos([info("engine-game-move")]);
    useAnalysisStore.getState().startSearch("pos|sf|1", "analysis-2");
    expect(useAnalysisStore.getState().topLines).toEqual([]);
  });

  it("tracks best moves, errors, and active engines", () => {
    useAnalysisStore.getState().setActiveEngine("engine-1");
    useAnalysisStore.getState().setBestMove("e2e4");
    expect(useAnalysisStore.getState()).toMatchObject({
      activeEngineId: "engine-1",
      bestMove: "e2e4",
      status: "ready"
    });

    useAnalysisStore.getState().setError("failed");
    expect(useAnalysisStore.getState()).toMatchObject({ error: "failed", status: "error" });
  });

  it("keeps the analysis target through a reset: only its owner clears it", () => {
    const target = { owner: "chapter", nodeId: "root", rootFen: "fen", moves: [], fen: "fen" };
    useAnalysisStore.getState().setTarget(target);
    useAnalysisStore.getState().reset();
    expect(useAnalysisStore.getState().target).toBe(target);
    useAnalysisStore.getState().setTarget(null);
    expect(useAnalysisStore.getState().target).toBeNull();
  });
});
