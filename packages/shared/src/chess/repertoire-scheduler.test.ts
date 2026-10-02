import { describe, expect, it } from "vitest";
import { REPERTOIRE_SCHEDULER_VERSION } from "../types/repertoire";
import {
  firstAnswerOutcome,
  LAPSE_RETRY_MS,
  orderQueue,
  scheduleAfterOutcome,
  STAGE_INTERVALS_DAYS,
  type RepertoireSchedule
} from "./repertoire-scheduler";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 2, 12);

function progress(patch: Partial<RepertoireSchedule> = {}): RepertoireSchedule {
  return {
    stage: 0,
    dueAt: null,
    lastAttemptAt: null,
    lapses: 0,
    unaidedSuccesses: 0,
    schedulerVersion: REPERTOIRE_SCHEDULER_VERSION,
    ...patch
  };
}

describe("scheduleAfterOutcome", () => {
  it("puts a new unaided card on stage 1, due in a day", () => {
    expect(scheduleAfterOutcome(null, "unaided", NOW)).toEqual({
      stage: 1,
      dueAt: NOW + DAY,
      lastAttemptAt: NOW,
      lapses: 0,
      unaidedSuccesses: 1,
      schedulerVersion: REPERTOIRE_SCHEDULER_VERSION
    });
  });

  it("advances one stage per unaided success through the intervals and caps at 60 days", () => {
    let current: RepertoireSchedule | null = null;
    let at = NOW;
    const intervals: number[] = [];
    for (let i = 0; i < 8; i++) {
      current = scheduleAfterOutcome(current, "unaided", at)!;
      intervals.push((current.dueAt! - at) / DAY);
      at = current.dueAt!;
    }
    expect(intervals).toEqual([...STAGE_INTERVALS_DAYS, 60, 60]);
    expect(current).toMatchObject({ stage: 6, unaidedSuccesses: 8 });
  });

  it("keeps the stage after an assisted answer, due in a day", () => {
    const next = scheduleAfterOutcome(progress({ stage: 3, lapses: 1 }), "assisted", NOW);
    expect(next).toMatchObject({ stage: 3, dueAt: NOW + DAY, lapses: 1, unaidedSuccesses: 0 });
  });

  it("resets on a wrong answer or a reveal, once per lapse, due in ten minutes", () => {
    for (const outcome of ["wrong", "reveal"] as const) {
      const next = scheduleAfterOutcome(progress({ stage: 4, lapses: 2 }), outcome, NOW);
      expect(next).toMatchObject({ stage: 0, lapses: 3, dueAt: NOW + LAPSE_RETRY_MS });
    }
  });

  it("changes nothing for no-change", () => {
    const stored = progress({ stage: 2, dueAt: NOW - 5 });
    expect(scheduleAfterOutcome(stored, "no-change", NOW)).toEqual(stored);
    expect(scheduleAfterOutcome(null, "no-change", NOW)).toBeNull();
  });

  it("never schedules before the last stored attempt when the clock moves backwards", () => {
    const later = NOW + 5 * DAY;
    const next = scheduleAfterOutcome(progress({ stage: 1, lastAttemptAt: later }), "unaided", NOW);
    expect(next).toMatchObject({ lastAttemptAt: later, dueAt: later + 3 * DAY });
    const viaArgument = scheduleAfterOutcome(null, "wrong", NOW, later);
    expect(viaArgument).toMatchObject({ lastAttemptAt: later, dueAt: later + LAPSE_RETRY_MS });
  });

  it("clamps a corrupt stored stage", () => {
    expect(scheduleAfterOutcome(progress({ stage: 99 }), "assisted", NOW)?.stage).toBe(6);
    expect(scheduleAfterOutcome(progress({ stage: Number.NaN }), "unaided", NOW)?.stage).toBe(1);
  });
});

describe("firstAnswerOutcome", () => {
  const correct = { kind: "attempt", correct: true } as const;
  const wrong = { kind: "attempt", correct: false } as const;
  const illegal = { kind: "attempt", legal: false } as const;
  const hint = { kind: "hint" } as const;
  const reveal = { kind: "reveal" } as const;
  const skip = { kind: "skip" } as const;

  it.each([
    ["correct first", [correct], "unaided"],
    ["illegal then correct", [illegal, correct], "unaided"],
    ["hint then correct", [hint, correct], "assisted"],
    ["two hints then correct", [hint, hint, correct], "assisted"],
    ["wrong first", [wrong], "wrong"],
    ["wrong then correct", [wrong, correct], "wrong"],
    ["hint then wrong", [hint, wrong], "wrong"],
    ["illegal then wrong", [illegal, wrong], "wrong"],
    ["reveal first", [reveal], "reveal"],
    ["hint then reveal", [hint, reveal], "reveal"],
    ["correct then reveal", [correct, reveal], "unaided"],
    ["only illegal", [illegal], "no-change"],
    ["only a hint", [hint], "no-change"],
    ["skip", [skip], "no-change"],
    ["nothing", [], "no-change"]
  ] as const)("%s → %s", (_label, actions, expected) => {
    expect(firstAnswerOutcome(actions)).toBe(expected);
  });
});

describe("orderQueue", () => {
  it("orders due cards by due time, then unseen by ply and chapter, stably", () => {
    const cards = [
      { id: "unseen-deep", dueAt: null, ply: 9, chapterOrder: 0 },
      { id: "due-late", dueAt: NOW - DAY, ply: 1, chapterOrder: 0 },
      { id: "unseen-ch1", dueAt: null, ply: 3, chapterOrder: 1 },
      { id: "unseen-ch0", dueAt: null, ply: 3, chapterOrder: 0 },
      { id: "due-early", dueAt: NOW - 3 * DAY, ply: 7, chapterOrder: 2 },
      { id: "unseen-ch0-tie", dueAt: null, ply: 3, chapterOrder: 0 }
    ];
    expect(orderQueue(cards).map((card) => card.id)).toEqual([
      "due-early",
      "due-late",
      "unseen-ch0",
      "unseen-ch0-tie",
      "unseen-ch1",
      "unseen-deep"
    ]);
  });

  it("puts cards not yet due last when `now` is given", () => {
    const cards = [
      { id: "future-far", dueAt: NOW + 2 * DAY, ply: 1, chapterOrder: 0 },
      { id: "future-near", dueAt: NOW + DAY, ply: 1, chapterOrder: 0 },
      { id: "unseen", dueAt: null, ply: 1, chapterOrder: 0 },
      { id: "due", dueAt: NOW, ply: 1, chapterOrder: 0 }
    ];
    expect(orderQueue(cards, NOW).map((card) => card.id)).toEqual([
      "due",
      "unseen",
      "future-near",
      "future-far"
    ]);
  });
});
