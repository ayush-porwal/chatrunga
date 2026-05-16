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
