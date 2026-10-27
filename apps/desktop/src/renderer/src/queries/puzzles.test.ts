import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PuzzleAttemptResult } from "@chaturanga/shared/types/puzzle-rating";
import type { DecidedPuzzleAttempt } from "../stores/puzzle-store";
import {
  attemptKey,
  isRecordable,
  recordAttemptEvent,
  recordInput,
  recordPuzzleAttemptEvent,
  usePuzzleRecordStore,
  type GamePuzzleAttemptRecorder
} from "./puzzles";

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
    expect(recordInput(attempt)).toStrictEqual({
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

describe("recordAttemptEvent", () => {
  const result: PuzzleAttemptResult = {
    attemptId: "a1",
    rated: true,
    unratedReason: null,
    before: null,
    after: null,
    delta: -12
  };
  const stateOf = () => usePuzzleRecordStore.getState().byAttempt.a1;

  function recorder(...outcomes: ("ok" | "fail")[]) {
    const recordAttempt = vi.fn(async () => {
      if (outcomes.shift() === "fail") throw new Error("database is locked");
      return result;
    });
    return { recordAttempt, onRecorded: vi.fn() };
  }

  beforeEach(() => {
    usePuzzleRecordStore.setState({ byAttempt: {} });
    vi.spyOn(console, "warn").mockReturnValue(undefined);
  });

  it("shows a decided attempt's result and refreshes the rating", async () => {
    const target = recorder("ok");
    const pending = recordAttemptEvent({ kind: "decided", attempt }, target);
    expect(stateOf()).toStrictEqual({ status: "saving" });
    await pending;
    expect(stateOf()).toStrictEqual({ status: "saved", result });
    expect(target.onRecorded).toHaveBeenCalledTimes(1);
  });

  it("a failed puzzle finished after its decided write failed shows the later write's result", async () => {
    const target = recorder("fail", "ok");
    await recordAttemptEvent({ kind: "decided", attempt }, target);
    expect(stateOf()).toStrictEqual({ status: "failed", message: "database is locked" });
    expect(target.onRecorded).not.toHaveBeenCalled();
    await recordAttemptEvent(
      { kind: "completed", attempt: { ...attempt, completedAt: 3_000 } },
      target
    );
    expect(target.recordAttempt).toHaveBeenLastCalledWith(
      expect.objectContaining({ attemptId: "a1", completedAt: 3_000 })
    );
    expect(stateOf()).toStrictEqual({ status: "saved", result });
    expect(target.onRecorded).toHaveBeenCalledTimes(1);
  });

  it("a completion that fails leaves what the decided write showed", async () => {
    const target = recorder("ok", "fail");
    await recordAttemptEvent({ kind: "decided", attempt }, target);
    await recordAttemptEvent(
      { kind: "completed", attempt: { ...attempt, completedAt: 3_000 } },
      target
    );
    expect(stateOf()).toStrictEqual({ status: "saved", result });
    expect(target.onRecorded).toHaveBeenCalledTimes(1);
  });

  it("records nothing for a clean solve's completion or an attempt that isn't the solver's result", async () => {
    const target = recorder();
    await recordAttemptEvent(
      { kind: "completed", attempt: { ...attempt, outcome: "solved", completedAt: 2_000 } },
      target
    );
    await recordAttemptEvent(
      {
        kind: "decided",
        attempt: { ...attempt, outcome: "void" } as unknown as DecidedPuzzleAttempt
      },
      target
    );
    expect(target.recordAttempt).not.toHaveBeenCalled();
    expect(stateOf()).toBeUndefined();
  });
});

describe("recordPuzzleAttemptEvent", () => {
  const gameAttempt: DecidedPuzzleAttempt = {
    ...attempt,
    id: "g1",
    puzzleId: "gp1",
    databaseId: "my-games",
    sourceId: "my-games",
    puzzleRating: null,
    puzzleRatingDeviation: null
  };

  function recorders() {
    return {
      puzzles: { recordAttempt: vi.fn(), onRecorded: vi.fn() },
      gamePuzzles: {
        recordAttempt: vi.fn<GamePuzzleAttemptRecorder["recordAttempt"]>(async () => ({
          stage: 0,
          dueAt: 1,
          lapses: 1,
          lastAttemptAt: 1,
          lastOutcome: "wrong" as const,
          attempts: 1
        })),
        onRecorded: vi.fn()
      }
    };
  }

  beforeEach(() => {
    usePuzzleRecordStore.setState({ byAttempt: {} });
    vi.spyOn(console, "warn").mockReturnValue(undefined);
  });

  it("schedules a From my games attempt once decided and never sends it to the puzzle rating", async () => {
    const target = recorders();
    await recordPuzzleAttemptEvent({ kind: "decided", attempt: gameAttempt }, target);
    await recordPuzzleAttemptEvent(
      { kind: "completed", attempt: { ...gameAttempt, completedAt: 3_000 } },
      target
    );
    expect(target.gamePuzzles.recordAttempt).toHaveBeenCalledTimes(1);
    expect(target.gamePuzzles.recordAttempt).toHaveBeenCalledWith({
      puzzleId: "gp1",
      outcome: "wrong"
    });
    expect(target.gamePuzzles.onRecorded).toHaveBeenCalledTimes(1);
    expect(target.puzzles.recordAttempt).not.toHaveBeenCalled();
  });

  it("schedules a clean solve as unaided and the solution shown as reveal", async () => {
    const target = recorders();
    const solved = { ...gameAttempt, outcome: "solved" as const, wrongMoves: [] };
    await recordPuzzleAttemptEvent({ kind: "decided", attempt: solved }, target);
    const revealed = { ...gameAttempt, wrongMoves: [], solutionViewed: true };
    await recordPuzzleAttemptEvent({ kind: "decided", attempt: revealed }, target);
    expect(
      target.gamePuzzles.recordAttempt.mock.calls.map(([input]) => input.outcome)
    ).toStrictEqual(["unaided", "reveal"]);
  });

  it("says on the card when scheduling failed", async () => {
    const target = recorders();
    target.gamePuzzles.recordAttempt.mockRejectedValueOnce(new Error("database is locked"));
    await recordPuzzleAttemptEvent({ kind: "decided", attempt: gameAttempt }, target);
    expect(usePuzzleRecordStore.getState().byAttempt.g1).toStrictEqual({
      status: "failed",
      message: "database is locked"
    });
    expect(target.gamePuzzles.onRecorded).not.toHaveBeenCalled();
  });

  it("sends every other set's attempt to the puzzle rating, as before", async () => {
    const target = recorders();
    await recordPuzzleAttemptEvent({ kind: "decided", attempt }, target);
    expect(target.puzzles.recordAttempt).toHaveBeenCalledTimes(1);
    expect(target.gamePuzzles.recordAttempt).not.toHaveBeenCalled();
  });
});
