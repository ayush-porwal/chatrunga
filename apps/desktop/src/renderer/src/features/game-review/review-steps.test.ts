import { describe, expect, it } from "vitest";
import { reviewStepAction } from "./review-steps";

// Three key insights: plies 7, 9 and 13.
const plies = [7, 9, 13];
const insight = (index: number) => ({ kind: "insight", index });
const summary = { kind: "summary" };

describe("reviewStepAction", () => {
  it("without key insights, says so and goes nowhere", () => {
    expect(reviewStepAction([], 0, false)).toStrictEqual({
      stage: "none",
      label: "No key moments",
      target: null
    });
  });

  it("without key insights, goes nowhere even once started", () => {
    expect(reviewStepAction([], 5, true)).toStrictEqual({
      stage: "none",
      label: "No key moments",
      target: null
    });
  });

  it("starts at the first insight, wherever the board is", () => {
    for (const ply of [0, 7, 10, 13, 20])
      expect(reviewStepAction(plies, ply, false)).toStrictEqual({
        stage: "start",
        label: "Start review",
        target: insight(0)
      });
  });

  it("on the first insight, goes on to the second", () => {
    expect(reviewStepAction(plies, 7, true)).toStrictEqual({
      stage: "next",
      label: "Next insight · 2 of 3",
      target: insight(1)
    });
  });

  it("between insights, goes to the next one after the current move", () => {
    expect(reviewStepAction(plies, 8, true)).toStrictEqual({
      stage: "next",
      label: "Next insight · 2 of 3",
      target: insight(1)
    });
    expect(reviewStepAction(plies, 11, true)).toStrictEqual({
      stage: "next",
      label: "Next insight · 3 of 3",
      target: insight(2)
    });
  });

  it("follows a jump ahead or behind instead of a stored position", () => {
    // Jumped ahead past the second insight: the third is next, the second isn't repeated.
    expect(reviewStepAction(plies, 10, true).target).toStrictEqual(insight(2));
    // Jumped back to the start: the first insight is next.
    expect(reviewStepAction(plies, 0, true)).toStrictEqual({
      stage: "next",
      label: "Next insight · 1 of 3",
      target: insight(0)
    });
  });

  it("on or after the last insight, finishes back on the summary", () => {
    for (const ply of [13, 14, 30])
      expect(reviewStepAction(plies, ply, true)).toStrictEqual({
        stage: "finish",
        label: "Finish review",
        target: summary
      });
  });

  it("with a single insight, starts at it and finishes from it", () => {
    expect(reviewStepAction([5], 0, false)).toStrictEqual({
      stage: "start",
      label: "Start review",
      target: insight(0)
    });
    expect(reviewStepAction([5], 5, true)).toStrictEqual({
      stage: "finish",
      label: "Finish review",
      target: summary
    });
    expect(reviewStepAction([5], 2, true)).toStrictEqual({
      stage: "next",
      label: "Next insight · 1 of 1",
      target: insight(0)
    });
  });
});
