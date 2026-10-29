import { describe, expect, it } from "vitest";
import type {
  RepertoireHealthFlag,
  RepertoireHealthQueueStatus
} from "@chaturanga/shared/types/repertoire-health";
import { DEFAULT_INSIGHTS_FILTERS } from "@chaturanga/shared/types/repertoire-insights";
import { filtersLine, flagFix, queueHeadline, shouldPrepare } from "./explorer-view";

const flag = (patch: Partial<RepertoireHealthFlag>): RepertoireHealthFlag => ({
  repertoireId: "r",
  positionKey: "k",
  fen: "fen",
  kind: "engine-disagrees",
  uci: "h2h3",
  san: "h3",
  bestUci: "f1e2",
  bestSan: "Be2",
  loss: 12,
  probability: null,
  rating: null,
  line: "1. e4",
  chapterId: "c",
  nodeId: "n",
  revision: 1,
  checkedAt: 0,
  ...patch
});

const idle: RepertoireHealthQueueStatus = {
  paused: false,
  waitingForEngine: false,
  waitingForPuzzles: false,
  problem: null,
  queued: [],
  current: null
};

describe("explorer view", () => {
  it("says which games the counts follow", () => {
    expect(filtersLine(DEFAULT_INSIGHTS_FILTERS)).toBe(
      "Filters: all time · all time controls (set in Insights)"
    );
    expect(
      filtersLine({
        ...DEFAULT_INSIGHTS_FILTERS,
        period: "1y",
        timeControls: ["blitz", "rapid"],
        ratedOnly: true,
        accounts: ["lichess"]
      })
    ).toBe("Filters: last 12 months · blitz, rapid · rated only · Lichess (set in Insights)");
  });

  it("marks an opponent's likely uncovered move at 10% or more to prepare", () => {
    const move = { uci: "c7c5", san: "c5", probability: 0.1, inRepertoire: false };
    expect(shouldPrepare(move, true)).toBe(true);
    expect(shouldPrepare({ ...move, probability: 0.09 }, true)).toBe(false);
    expect(shouldPrepare({ ...move, inRepertoire: true }, true)).toBe(false);
    expect(shouldPrepare(move, false)).toBe(false);
  });

  it("stages each flag's fix from its position", () => {
    expect(flagFix(flag({}))).toStrictEqual(["f1e2"]);
    expect(flagFix(flag({ kind: "no-answer", uci: "c7c5", bestUci: null }))).toStrictEqual([
      "c7c5"
    ]);
    expect(flagFix(flag({ kind: "common-mistake", uci: "e7e5", bestUci: "f3e5" }))).toStrictEqual([
      "e7e5",
      "f3e5"
    ]);
  });

  it("says what the queue is doing, or nothing when it is idle", () => {
    expect(queueHeadline(idle)).toBeNull();
    const current = { repertoireId: "r", name: "Caro-Kann", done: 3, total: 12 };
    expect(queueHeadline({ ...idle, current })).toBe("Checking Caro-Kann… 3 of 12");
    expect(queueHeadline({ ...idle, current, waitingForPuzzles: true })).toBe(
      "Waiting for puzzle generation to finish (Caro-Kann)"
    );
    expect(queueHeadline({ ...idle, paused: true, queued: ["r"] })).toBe(
      "Paused · 1 repertoire waiting"
    );
  });
});
