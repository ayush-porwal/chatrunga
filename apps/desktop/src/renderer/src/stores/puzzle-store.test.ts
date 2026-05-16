import { beforeEach, describe, expect, it } from "vitest";
import { usePuzzleStore } from "./puzzle-store";
import type { PuzzleSample } from "@chaturanga/shared/types/database";

const puzzle: PuzzleSample = {
  id: "p1",
  databaseId: "db1",
  sourceId: "lichess-puzzles",
  sourceName: "Lichess",
  initialFen: "8/8/8/8/8/8/8/8 w - - 0 1",
  solutionMoves: ["e2e4", "e7e5"],
  themes: ["fork"],
  openingTags: [],
  sideToMove: "white"
};

describe("puzzle store", () => {
  beforeEach(() => {
    usePuzzleStore.getState().reset();
  });

  it("initializes puzzle feedback", () => {
    usePuzzleStore.getState().setActivePuzzle(puzzle);

    expect(usePuzzleStore.getState()).toMatchObject({
      activePuzzle: puzzle,
      solutionIndex: 0,
      feedbackKind: "idle",
      feedback: "Find the best move."
    });
  });

  it("advances and clamps solution progress", () => {
    usePuzzleStore.getState().setActivePuzzle(puzzle);
    usePuzzleStore.getState().advanceSolution(3, "Nice");

    expect(usePuzzleStore.getState()).toMatchObject({
      solutionIndex: 2,
      feedbackKind: "correct",
      feedback: "Nice"
    });
  });

  it("tracks wrong moves and completion", () => {
    usePuzzleStore.getState().setActivePuzzle(puzzle);
    usePuzzleStore.getState().markWrongMove({ played: "a2a3", expected: "e2e4" });
    expect(usePuzzleStore.getState()).toMatchObject({
      feedbackKind: "wrong",
      lastExpectedMove: "e2e4"
    });

    usePuzzleStore.getState().markComplete();
    expect(usePuzzleStore.getState()).toMatchObject({
      feedbackKind: "complete",
      solutionIndex: 2,
      lastExpectedMove: null
    });
  });
});
