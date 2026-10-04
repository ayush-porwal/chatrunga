import { afterEach, describe, expect, it } from "vitest";
import type { EngineInfo } from "@chaturanga/shared/types/engine";
import { useAnalysisStore } from "../stores/analysis-store";
import { applyEngineInfos, createEngineInfoBuffer, engineSearches } from "./useEngineDriver";

function info(multipv: number, searchId?: string): EngineInfo {
  return {
    engineId: "e",
    searchId,
    multipv,
    score: { type: "cp", value: multipv },
    pv: [],
    raw: "",
    receivedAt: 0
  };
}

function fakeTimers() {
  let now = 0;
  const pending: Array<{ at: number; callback: () => void; id: number }> = [];
  let nextId = 1;
  return {
    timers: {
      now: () => now,
      start: (callback: () => void, ms: number) => {
        const id = nextId++;
        pending.push({ at: now + ms, callback, id });
        return () => {
          const index = pending.findIndex((item) => item.id === id);
          if (index >= 0) pending.splice(index, 1);
        };
      }
    },
    advance(ms: number) {
      now += ms;
      for (const item of pending.filter((entry) => entry.at <= now)) {
        pending.splice(pending.indexOf(item), 1);
        item.callback();
      }
    }
  };
}

describe("createEngineInfoBuffer", () => {
  it("shows the first info at once, then batches the burst into one trailing flush", () => {
    const clock = fakeTimers();
    const flushed: number[][] = [];
    const buffer = createEngineInfoBuffer(
      (infos) => flushed.push(infos.map((item) => item.multipv ?? 1)),
      150,
      clock.timers
    );
    buffer.push(info(1));
    expect(flushed).toEqual([[1]]);
    clock.advance(20);
    buffer.push(info(2));
    buffer.push(info(3));
    clock.advance(20);
    buffer.push(info(1));
    expect(flushed).toHaveLength(1);
    clock.advance(110);
    expect(flushed).toEqual([[1], [2, 3, 1]]);
  });

  it("flushes on demand and drops pending infos on discard", () => {
    const clock = fakeTimers();
    const flushed: number[][] = [];
    const buffer = createEngineInfoBuffer(
      (infos) => flushed.push(infos.map((item) => item.multipv ?? 1)),
      150,
      clock.timers
    );
    buffer.push(info(1));
    buffer.push(info(2));
    buffer.flushNow();
    buffer.push(info(3));
    buffer.discard();
    clock.advance(500);
    expect(flushed).toEqual([[1], [2]]);
  });
});

describe("applyEngineInfos", () => {
  afterEach(() => {
    engineSearches.move = null;
    engineSearches.analysis = null;
    useAnalysisStore.getState().reset();
  });

  it("drops buffered lines of a search replaced on the same position before the flush", () => {
    const clock = fakeTimers();
    const buffer = createEngineInfoBuffer(applyEngineInfos, 150, clock.timers);
    engineSearches.analysis = "old";
    buffer.push(info(1, "old"));
    buffer.push(info(2, "old"));
    // restartSearch: a new search id is installed and the analysis cleared, same node and mode.
    engineSearches.analysis = "new";
    useAnalysisStore.getState().startSearch();
    clock.advance(150);
    expect(useAnalysisStore.getState().topLines).toEqual([]);
    buffer.push(info(1, "new"));
    clock.advance(150);
    expect(useAnalysisStore.getState().topLines.map((line) => line.searchId)).toEqual(["new"]);
  });
});
