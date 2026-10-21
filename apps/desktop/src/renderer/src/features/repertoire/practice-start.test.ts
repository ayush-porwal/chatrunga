import { describe, expect, it } from "vitest";
import type {
  PracticeSessionSnapshot,
  StartPracticeInput
} from "@chaturanga/shared/types/repertoire";
import { cardOf } from "./__fixtures__/repertoire";
import { beginStart, IDLE_START, isEmptyTargetedStart, settleStart } from "./practice-start";

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
