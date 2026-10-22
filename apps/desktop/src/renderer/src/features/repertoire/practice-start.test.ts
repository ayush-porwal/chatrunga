import { describe, expect, it, vi } from "vitest";
import type {
  PracticeSessionSnapshot,
  StartPracticeInput
} from "@chaturanga/shared/types/repertoire";
import { cardOf } from "./__fixtures__/repertoire";
import {
  answerStillShown,
  beginStart,
  IDLE_START,
  isEmptyTargetedStart,
  NavigationStarts,
  settleStart
} from "./practice-start";

const REHEARSE: StartPracticeInput = {
  repertoireId: "r1",
  mode: "rehearse-lines",
  rehearse: { chapterId: "c1" }
};
const REVIEW: StartPracticeInput = { repertoireId: "r1", mode: "review-due" };

function snapshot(cards: number): PracticeSessionSnapshot {
  return {
    sessionId: "s1",
    repertoireId: "r1",
    mode: "review-due",
    scope: { repertoireId: "r1" },
    status: cards ? "active" : "finished",
    cursor: 0,
    cards: Array.from({ length: cards }, (_, index) => cardOf(`q${index + 1}`)),
    totals: {
      total: cards,
      answered: 0,
      correct: 0,
      wrong: 0,
      revealed: 0,
      skipped: 0,
      remaining: cards
    }
  };
}

describe("practice start", () => {
  it("an answer with cards ends idle; one without is empty with the start's input", () => {
    const starting = beginStart(1, REHEARSE);
    expect(settleStart(starting, 1, { kind: "answered", snapshot: snapshot(2) })).toStrictEqual(
      IDLE_START
    );
    const empty = settleStart(starting, 1, { kind: "answered", snapshot: snapshot(0) });
    expect(empty).toStrictEqual({ status: "empty", input: REHEARSE });
  });

  it("a failure keeps the message and the input", () => {
    expect(
      settleStart(beginStart(3, REVIEW), 3, { kind: "failed", message: "Nope" })
    ).toStrictEqual({ status: "failed", input: REVIEW, message: "Nope" });
  });

  it("only the newest start settles the state", () => {
    const newer = beginStart(2, REVIEW);
    expect(settleStart(newer, 1, { kind: "answered", snapshot: snapshot(0) })).toBe(newer);
    expect(settleStart(IDLE_START, 1, { kind: "failed", message: "late" })).toBe(IDLE_START);
  });

  it("tells an empty targeted queue from an empty scope", () => {
    const targeted = { ...REVIEW, positionKeys: ["k1"] };
    expect(isEmptyTargetedStart({ status: "empty", input: targeted })).toBe(true);
    expect(isEmptyTargetedStart({ status: "empty", input: REVIEW })).toBe(false);
    expect(isEmptyTargetedStart(beginStart(1, targeted))).toBe(false);
  });
});

describe("a start's answer", () => {
  it("renames only the session-less navigation that asked for it", () => {
    const again = {};
    const asked = { sessionId: null, preset: again };
    expect(answerStillShown(asked, { sessionId: null, preset: again })).toBe(true);
    // Back during "Starting practice" restores the session it came from on the same page.
    expect(answerStillShown(asked, { sessionId: "sA", preset: null })).toBe(false);
    // Back / Forward to another session-less entry (its own navigation).
    expect(answerStillShown(asked, { sessionId: null, preset: {} })).toBe(false);
    // A start asked while a session was named never renames it.
    expect(
      answerStillShown({ sessionId: "sA", preset: null }, { sessionId: "sA", preset: null })
    ).toBe(false);
  });
});

describe("starts by navigation", () => {
  it("runs once per navigation: showing it again (Back, a remount) gets the first answer", async () => {
    const starts = new NavigationStarts<object, PracticeSessionSnapshot>();
    const start = vi.fn(async () => snapshot(2));
    const navigation = {};
    const first = starts.run(navigation, start);
    expect(first.reused).toBe(false);
    const again = starts.run(navigation, start);
    expect(again).toStrictEqual({ answer: first.answer, reused: true });
    expect(start).toHaveBeenCalledTimes(1);
    // A new navigation (a fresh Practice, "Practice again") starts its own session.
    expect(starts.run({}, start).reused).toBe(false);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("is pending until the start answers or fails", async () => {
    const starts = new NavigationStarts<object, PracticeSessionSnapshot>();
    let answer: (value: PracticeSessionSnapshot) => void = () => undefined;
    const answered = {};
    const run = starts.run(answered, () => new Promise((resolve) => (answer = resolve)));
    expect(starts.pending(answered)).toBe(true);
    expect(starts.pending({})).toBe(false);
    answer(snapshot(1));
    await run.answer;
    expect(starts.pending(answered)).toBe(false);

    const failed = {};
    const failure = starts.run(failed, async () => {
      throw new Error("Nope");
    });
    await expect(failure.answer).rejects.toThrow("Nope");
    expect(starts.pending(failed)).toBe(false);
    // A failed start is not made again for its navigation either: Try again is its own start.
    expect(starts.run(failed, async () => snapshot(1)).answer).toBe(failure.answer);
  });
});
