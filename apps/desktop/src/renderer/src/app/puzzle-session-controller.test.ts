import { describe, expect, it } from "vitest";
import type { PuzzleSessionConfig } from "../features/puzzles/PuzzlePage";
import {
  continuePuzzleSet,
  continuesPuzzleSet,
  endPuzzleSet,
  joinPuzzleSet,
  nextPuzzleInput,
  NO_PUZZLE_SET,
  resumePuzzleSet,
  shownInSet,
  snapshotPuzzleSet,
  startPuzzleSet,
  type PuzzleSessionState
} from "./puzzle-session-controller";

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

  it("asks a set of failed puzzles for those by id, without the filters", () => {
    const retry = { ...config, retryIds: ["x", "y"], lichess: { ratingMin: 0 } } as PuzzleSessionConfig;
    expect(nextPuzzleInput(retry, ["x"])).toEqual({ databaseId: "lichess-puzzles", excludeIds: ["x"], ids: ["x", "y"] });
  });

  it("is null without a dataset", () => {
    expect(nextPuzzleInput(null, [])).toBeNull();
  });
});

describe("puzzle set state", () => {
  const other = { ...config, databaseId: "other" } as PuzzleSessionConfig;
  /** The request Next puzzle makes in `state`. */
  const excluded = (state: PuzzleSessionState) => nextPuzzleInput(state.set?.config ?? null, shownInSet(state))?.excludeIds;

  it("records the set's id, filters and the puzzles shown, and nothing without a set", () => {
    const state = joinPuzzleSet(startPuzzleSet(NO_PUZZLE_SET, "a", { id: "s", config }), "b");
    expect(snapshotPuzzleSet(state)).toEqual({ id: "s", config, shownIds: ["a", "b"] });
    expect(snapshotPuzzleSet(endPuzzleSet(state))).toBeNull();
    expect(joinPuzzleSet(NO_PUZZLE_SET, "a")).toEqual(NO_PUZZLE_SET);
  });

  it("resumes the set with a game history brought back, so Next puzzle shows there again", () => {
    const state = startPuzzleSet(NO_PUZZLE_SET, "a", { id: "s", config });
    const game = snapshotPuzzleSet(continuePuzzleSet(state, 7))!;
    // Back to that game after the board was replaced (the set ended meanwhile).
    const resumed = resumePuzzleSet(endPuzzleSet(joinPuzzleSet(state, "b")), game, 9);
    expect(continuesPuzzleSet(resumed.set?.config ?? null, resumed.continuationBoard, 9)).toBe(true);
    expect(excluded(resumed)).toEqual(["a", "b"]);
  });

  it("never repeats a puzzle after Back: puzzle, engine game, next puzzle, Back twice, Next puzzle", () => {
    let state = startPuzzleSet(NO_PUZZLE_SET, "a", { id: "s", config });
    const puzzleEntry = snapshotPuzzleSet(state)!; // captured on Play engine from here
    state = continuePuzzleSet(state, 7);
    const gameEntry = snapshotPuzzleSet(state)!; // captured on Next puzzle after the game
    state = joinPuzzleSet(state, "b");
    state = resumePuzzleSet(state, gameEntry, 8); // Back to the game
    state = startPuzzleSet(state, "a", puzzleEntry); // Back to the first puzzle
    expect(puzzleEntry.shownIds).toEqual(["a"]);
    expect(excluded(state)).toEqual(["a", "b"]);
    state = joinPuzzleSet(state, "c"); // Next puzzle
    expect(excluded(state)).toEqual(["a", "b", "c"]);
  });

  it("starts a new set with its first puzzle alone, and keeps the old set's for history going back to it", () => {
    let state = joinPuzzleSet(startPuzzleSet(NO_PUZZLE_SET, "a", { id: "s", config }), "b");
    const first = snapshotPuzzleSet(state)!;
    state = startPuzzleSet(state, "a", { id: "t", config: other });
    expect(snapshotPuzzleSet(state)).toEqual({ id: "t", config: other, shownIds: ["a"] });
    state = startPuzzleSet(state, "b", { ...first, shownIds: ["a"] });
    expect(excluded(state)).toEqual(["a", "b"]);
    expect(state.continuationBoard).toBeNull();
  });
});
