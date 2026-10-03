import { describe, expect, it } from "vitest";
import type { DecidedPuzzleAttempt } from "../stores/puzzle-store";
import { attemptKey, isRecordable, recordInput, usePuzzleRecordStore } from "./puzzles";

const attempt: DecidedPuzzleAttempt = {
  id: "a1",
  puzzleId: "00sHx",
  databaseId: "db1",
  sourceId: "lichess-puzzles",
  puzzleRating: 1760,
  puzzleRatingDeviation: 80,
  themes: ["mate", "short"],
  wrongMoves: [
    { solutionIndex: 0, fen: "fen", uci: "a2a3", san: "a3", expectedUci: "a2e6", at: 2_000 },
    { solutionIndex: 0, fen: "fen", uci: "b2b3", san: "b3", expectedUci: "a2e6", at: 2_500 }
  ],
  solutionViewed: false,
  startedAt: 1_000,
  decidedAt: 2_000,
  completedAt: null,
  outcome: "failed"
};

describe("recordInput", () => {
  it("sends the attempt's id, puzzle, outcome and counts — not the wrong moves themselves", () => {
    expect(recordInput(attempt)).toEqual({
      attemptId: "a1",
      puzzleId: "00sHx",
      databaseId: "db1",
      sourceId: "lichess-puzzles",
      outcome: "failed",
      puzzleRating: 1760,
      puzzleRatingDeviation: 80,
      themes: ["mate", "short"],
      wrongMoveCount: 2,
      solutionViewed: false,
      startedAt: 1_000,
      decidedAt: 2_000,
      completedAt: null
    });
  });
});

describe("what is recorded", () => {
  it("keys an attempt by its id, else by its puzzle and start", () => {
    expect(attemptKey(attempt)).toBe("a1");
    expect(attemptKey({ ...attempt, id: "" })).toBe("00sHx:1000");
  });

  it("records only a solve or a failure", () => {
    expect(isRecordable({ outcome: "solved" })).toBe(true);
    expect(isRecordable({ outcome: "failed" })).toBe(true);
    expect(isRecordable({ outcome: "pending" })).toBe(false);
    expect(isRecordable({ outcome: "void" })).toBe(false);
  });
});

describe("usePuzzleRecordStore", () => {
  it("keeps the latest results only", () => {
    const { set } = usePuzzleRecordStore.getState();
    for (let index = 0; index < 30; index += 1) set(`a${index}`, { status: "saving" });
    const kept = Object.keys(usePuzzleRecordStore.getState().byAttempt);
    expect(kept).toHaveLength(20);
    expect(kept.at(-1)).toBe("a29");
    expect(kept).not.toContain("a0");
  });
});
