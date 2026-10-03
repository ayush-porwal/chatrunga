import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import { usePuzzleStore } from "../../stores/puzzle-store";
import { submitPuzzleMove } from "./puzzle-session";

const puzzle: PuzzleSample = {
  id: "p1",
  databaseId: "db1",
  sourceId: "lichess-puzzles",
  sourceName: "Lichess",
  initialFen: "8/8/8/8/8/8/8/8 w - - 0 1",
  solutionMoves: ["e2e4", "e7e5", "g1f3"],
  themes: [],
  openingTags: [],
  sideToMove: "white"
};

describe("submitPuzzleMove", () => {
  beforeEach(() => {
    usePuzzleStore.getState().reset();
    usePuzzleStore.getState().setActivePuzzle(puzzle);
  });

  it("plays the expected move and advances the solution", () => {
    const play = vi.fn(() => true);
    expect(submitPuzzleMove("e2e4", play)).toBe(true);
    expect(play).toHaveBeenCalledOnce();
    expect(usePuzzleStore.getState()).toMatchObject({ solutionIndex: 1, feedbackKind: "correct" });
  });

  it("marks any other move wrong without playing it", () => {
    const play = vi.fn(() => true);
    expect(submitPuzzleMove("d2d4", play)).toBe(false);
    expect(play).not.toHaveBeenCalled();
    expect(usePuzzleStore.getState()).toMatchObject({ solutionIndex: 0, feedbackKind: "wrong", lastExpectedMove: "e2e4" });
  });

  it("records the wrong move with the position it was played from, failing the puzzle", () => {
    const fen = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1";
    usePuzzleStore.getState().setActivePuzzle({ ...puzzle, initialFen: fen, solutionMoves: ["a1a8"] });
    submitPuzzleMove("a1a5", () => true, fen);
    expect(usePuzzleStore.getState().outcome).toBe("failed");
    expect(usePuzzleStore.getState().attempt?.wrongMoves).toMatchObject([
      { solutionIndex: 0, fen, uci: "a1a5", san: "Ra5", expectedUci: "a1a8" }
    ]);
    // Finishing it afterwards doesn't make it solved.
    expect(submitPuzzleMove("a1a8", () => true, fen)).toBe(true);
    expect(usePuzzleStore.getState()).toMatchObject({ feedbackKind: "complete", outcome: "failed" });
  });

  it("solves a puzzle finished without a wrong move", () => {
    usePuzzleStore.getState().setActivePuzzle({ ...puzzle, solutionMoves: ["e2e4"] });
    expect(submitPuzzleMove("e2e4", () => true)).toBe(true);
    expect(usePuzzleStore.getState().outcome).toBe("solved");
  });

  it("names the wrong move in SAN, and still accepts the right move afterwards", () => {
    const fen = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1";
    usePuzzleStore.getState().setActivePuzzle({ ...puzzle, initialFen: fen, solutionMoves: ["a1a8"] });
    expect(submitPuzzleMove("a1a5", () => true, fen)).toBe(false);
    expect(usePuzzleStore.getState().feedback).toBe("Not quite. Ra5 is not the tactic.");
    expect(submitPuzzleMove("a1a8", () => true, fen)).toBe(true);
    expect(usePuzzleStore.getState().feedbackKind).toBe("complete");
  });

  it("does not advance when the move cannot be played", () => {
    expect(submitPuzzleMove("e2e4", () => false)).toBe(false);
    expect(usePuzzleStore.getState().solutionIndex).toBe(0);
  });

  it("ignores moves once the puzzle's data broke, without failing the solver", () => {
    usePuzzleStore.getState().markReplyFailed();
    const play = vi.fn(() => true);
    expect(submitPuzzleMove("e2e4", play)).toBe(false);
    expect(submitPuzzleMove("d2d4", play)).toBe(false);
    expect(play).not.toHaveBeenCalled();
    expect(usePuzzleStore.getState()).toMatchObject({ feedbackKind: "broken", outcome: "void", solutionIndex: 0 });
  });

  it("completes the puzzle on the last solution move", () => {
    usePuzzleStore.setState({ solutionIndex: 2 });
    expect(submitPuzzleMove("g1f3", () => true)).toBe(true);
    expect(usePuzzleStore.getState()).toMatchObject({ solutionIndex: 3, feedbackKind: "complete" });
  });

  it("ignores moves once the puzzle is solved", () => {
    usePuzzleStore.getState().markComplete();
    const play = vi.fn(() => true);
    expect(submitPuzzleMove("a2a3", play)).toBe(false);
    expect(play).not.toHaveBeenCalled();
  });
});
