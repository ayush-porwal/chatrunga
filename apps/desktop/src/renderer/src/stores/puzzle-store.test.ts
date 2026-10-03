import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onPuzzleAttempt, selectFirstWrongMove, usePuzzleStore, type PuzzleAttemptEvent } from "./puzzle-store";
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
    usePuzzleStore.getState().markWrongMove({ uci: "a2a3", san: "a3", fen: puzzle.initialFen, expected: "e2e4" });
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

describe("puzzle outcome", () => {
  const start = puzzle.initialFen;
  let events: PuzzleAttemptEvent[] = [];
  let unsubscribe: () => void = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    usePuzzleStore.getState().reset();
    events = [];
    unsubscribe = onPuzzleAttempt((event) => events.push(event));
  });

  afterEach(() => {
    unsubscribe();
    vi.useRealTimers();
  });

  it("starts a pending attempt for the puzzle shown", () => {
    usePuzzleStore.getState().setActivePuzzle({ ...puzzle, rating: 1650 });
    expect(usePuzzleStore.getState().outcome).toBe("pending");
    expect(usePuzzleStore.getState().attempt).toEqual({
      id: expect.any(String),
      puzzleId: "p1",
      databaseId: "db1",
      sourceId: "lichess-puzzles",
      puzzleRating: 1650,
      wrongMoves: [],
      solutionViewed: false,
      startedAt: 1_000,
      decidedAt: null,
      completedAt: null
    });
    expect(events).toEqual([]);
  });

  it("is solved when finished without a wrong move or the solution", () => {
    usePuzzleStore.getState().setActivePuzzle(puzzle);
    usePuzzleStore.getState().advanceSolution(1);
    vi.setSystemTime(5_000);
    usePuzzleStore.getState().markComplete();
    const state = usePuzzleStore.getState();
    expect(state.outcome).toBe("solved");
    expect(state.attempt).toMatchObject({ decidedAt: 5_000, completedAt: 5_000, wrongMoves: [] });
    expect(events.map((event) => [event.kind, event.attempt.outcome])).toEqual([
      ["decided", "solved"],
      ["completed", "solved"]
    ]);
  });

  it("fails on the first wrong move, records every wrong move, and stays failed once finished", () => {
    usePuzzleStore.getState().setActivePuzzle(puzzle);
    vi.setSystemTime(2_000);
    usePuzzleStore.getState().markWrongMove({ uci: "a2a3", san: "a3", fen: start, expected: "e2e4" });
    expect(usePuzzleStore.getState().outcome).toBe("failed");
    expect(events.map((event) => event.kind)).toEqual(["decided"]);

    vi.setSystemTime(3_000);
    usePuzzleStore.getState().markWrongMove({ uci: "h2h3", san: "h3", fen: start, expected: "e2e4" });
    usePuzzleStore.getState().advanceSolution(1);
    vi.setSystemTime(4_000);
    usePuzzleStore.getState().markComplete();

    const state = usePuzzleStore.getState();
    expect(state.outcome).toBe("failed");
    expect(state.feedback).toBe("Puzzle complete.");
    expect(state.attempt).toMatchObject({ decidedAt: 2_000, completedAt: 4_000, solutionViewed: false });
    expect(state.attempt?.wrongMoves).toEqual([
      { solutionIndex: 0, fen: start, uci: "a2a3", san: "a3", expectedUci: "e2e4", at: 2_000 },
      { solutionIndex: 0, fen: start, uci: "h2h3", san: "h3", expectedUci: "e2e4", at: 3_000 }
    ]);
    expect(selectFirstWrongMove(state)).toMatchObject({ uci: "a2a3", fen: start });
    // Decided once (the first wrong move), then completed — with the outcome it was decided with.
    expect(events.map((event) => [event.kind, event.attempt.outcome])).toEqual([
      ["decided", "failed"],
      ["completed", "failed"]
    ]);
  });

  it("fails when the solution is opened before it is solved", () => {
    usePuzzleStore.getState().setActivePuzzle(puzzle);
    vi.setSystemTime(2_500);
    usePuzzleStore.getState().revealSolution();
    usePuzzleStore.getState().revealSolution();
    const state = usePuzzleStore.getState();
    expect(state.outcome).toBe("failed");
    expect(state.attempt).toMatchObject({ solutionViewed: true, decidedAt: 2_500, wrongMoves: [] });
    expect(selectFirstWrongMove(state)).toBeNull();
    expect(events.map((event) => event.kind)).toEqual(["decided"]);
  });

  it("opening the solution after a wrong move records it without deciding again", () => {
    usePuzzleStore.getState().setActivePuzzle(puzzle);
    usePuzzleStore.getState().markWrongMove({ uci: "a2a3", san: "a3", fen: start, expected: "e2e4" });
    usePuzzleStore.getState().revealSolution();
    expect(usePuzzleStore.getState().attempt).toMatchObject({ solutionViewed: true });
    expect(events.map((event) => event.kind)).toEqual(["decided"]);
  });

  it("keeps a solved puzzle solved when its solution is opened afterwards", () => {
    usePuzzleStore.getState().setActivePuzzle(puzzle);
    usePuzzleStore.getState().markComplete();
    usePuzzleStore.getState().revealSolution();
    expect(usePuzzleStore.getState().outcome).toBe("solved");
    expect(usePuzzleStore.getState().attempt?.solutionViewed).toBe(false);
  });

  it("a reply the puzzle couldn't play ends it as broken: void, the solver not failed, nothing to rate", () => {
    usePuzzleStore.getState().setActivePuzzle(puzzle);
    usePuzzleStore.getState().markReplyFailed();
    expect(usePuzzleStore.getState()).toMatchObject({ feedbackKind: "broken", outcome: "void", lastExpectedMove: null });
    expect(usePuzzleStore.getState().attempt).toMatchObject({ wrongMoves: [], decidedAt: null, completedAt: null });
    // Ended: nothing afterwards decides it (a move, the solution opened, the line finished).
    usePuzzleStore.getState().markWrongMove({ uci: "a2a3", san: "a3", fen: start, expected: "e2e4" });
    usePuzzleStore.getState().revealSolution();
    usePuzzleStore.getState().markComplete();
    expect(usePuzzleStore.getState()).toMatchObject({ feedbackKind: "broken", outcome: "void" });
    expect(events).toEqual([]);
  });

  it("a puzzle already failed stays failed when its reply then breaks", () => {
    usePuzzleStore.getState().setActivePuzzle(puzzle);
    usePuzzleStore.getState().markWrongMove({ uci: "a2a3", san: "a3", fen: start, expected: "e2e4" });
    usePuzzleStore.getState().markReplyFailed();
    expect(usePuzzleStore.getState()).toMatchObject({ feedbackKind: "broken", outcome: "failed" });
    expect(events.map((event) => event.kind)).toEqual(["decided"]);
  });

  it("a new puzzle starts a new attempt, and a reset clears it", () => {
    usePuzzleStore.getState().setActivePuzzle(puzzle);
    usePuzzleStore.getState().markWrongMove({ uci: "a2a3", san: "a3", fen: start, expected: "e2e4" });
    usePuzzleStore.getState().setActivePuzzle({ ...puzzle, id: "p2" });
    expect(usePuzzleStore.getState()).toMatchObject({ outcome: "pending", attempt: { puzzleId: "p2", wrongMoves: [] } });
    usePuzzleStore.getState().reset();
    expect(usePuzzleStore.getState()).toMatchObject({ outcome: "pending", attempt: null, activePuzzle: null });
  });

  it("starting the same puzzle again is a new attempt, the solution not viewed in it", () => {
    usePuzzleStore.getState().setActivePuzzle(puzzle);
    usePuzzleStore.getState().revealSolution();
    const first = usePuzzleStore.getState().attempt;
    expect(first).toMatchObject({ solutionViewed: true });
    usePuzzleStore.getState().setActivePuzzle(puzzle);
    const again = usePuzzleStore.getState().attempt;
    expect(again).toMatchObject({ puzzleId: "p1", solutionViewed: false, decidedAt: null });
    expect(again?.id).toEqual(expect.any(String));
    expect(again?.id).not.toBe(first?.id);
    expect(usePuzzleStore.getState().outcome).toBe("pending");
  });

  it("stops reporting to an unsubscribed listener", () => {
    unsubscribe();
    usePuzzleStore.getState().setActivePuzzle(puzzle);
    usePuzzleStore.getState().markComplete();
    expect(events).toEqual([]);
  });
});
