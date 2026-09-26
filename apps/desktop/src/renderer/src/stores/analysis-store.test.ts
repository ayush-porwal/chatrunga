import { beforeEach, describe, expect, it } from "vitest";
import { useAnalysisStore } from "./analysis-store";
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
});
