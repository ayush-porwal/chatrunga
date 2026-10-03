import { describe, expect, it } from "vitest";
import type { PuzzleSessionConfig } from "../features/puzzles/PuzzlePage";
import { continuesPuzzleSet, nextPuzzleInput, resumePuzzleSet, snapshotPuzzleSet } from "./puzzle-session-controller";

const config = { databaseId: "lichess-puzzles" } as PuzzleSessionConfig;

describe("continuesPuzzleSet", () => {
  it("goes on with the game played from the set's puzzle while that board is loaded", () => {
    expect(continuesPuzzleSet(config, 7, 7)).toBe(true);
  });

  it("ends once another board replaces that game", () => {
    expect(continuesPuzzleSet(config, 7, 8)).toBe(false);
  });

  it("needs a set and a game played on from it", () => {
    expect(continuesPuzzleSet(null, 7, 7)).toBe(false);
    expect(continuesPuzzleSet(config, null, 7)).toBe(false);
  });
});

describe("nextPuzzleInput", () => {
  it("asks for the set's next puzzle, excluding the ones shown", () => {
    expect(nextPuzzleInput(config, ["a", "b"])).toMatchObject({ databaseId: "lichess-puzzles", excludeIds: ["a", "b"] });
  });

  it("is null without a dataset", () => {
    expect(nextPuzzleInput(null, [])).toBeNull();
  });
});

describe("puzzle set snapshots", () => {
  it("records the set's filters and the puzzles shown, and nothing without a set", () => {
    expect(snapshotPuzzleSet({ config, shownIds: ["a"], continuationBoard: 3 })).toEqual({ config, shownIds: ["a"] });
    expect(snapshotPuzzleSet({ config: null, shownIds: [], continuationBoard: null })).toBeNull();
  });

  it("resumes the set with a game history brought back, so Next puzzle shows there again", () => {
    const resumed = resumePuzzleSet({ config, shownIds: ["a", "b"] }, 9);
    expect(continuesPuzzleSet(resumed.config, resumed.continuationBoard, 9)).toBe(true);
    expect(nextPuzzleInput(resumed.config, resumed.shownIds)).toMatchObject({ excludeIds: ["a", "b"] });
  });
});
