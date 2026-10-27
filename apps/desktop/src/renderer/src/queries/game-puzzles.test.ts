import { describe, expect, it, vi } from "vitest";
import type { GamePuzzle } from "@chaturanga/shared/types/game-puzzles";
import { drawGamePuzzle } from "./game-puzzles";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function puzzle(id: string, setupMove: string | null): GamePuzzle {
  return {
    id,
    gameId: "g1",
    ply: 1,
    kind: "mistake",
    tags: [],
    solverSide: "white",
    startFen: START,
    setupMove,
    solution: ["e2e4"],
    playedMove: "a2a3",
    winBefore: 50,
    winAfter: 30,
    difficulty: null,
    difficultyCapped: false,
    userChance: null,
    chanceRating: null,
    themes: [],
    progress: {
      stage: 0,
      dueAt: null,
      lapses: 0,
      lastAttemptAt: null,
      lastOutcome: null,
      attempts: 0
    },
    game: { source: "imported", opponent: null, date: null, moveNumber: 1 }
  };
}

describe("drawGamePuzzle", () => {
  it("draws the next puzzle with the set's filters, leaving out the ones shown", async () => {
    const next = vi.fn(async () => puzzle("p1", null));
    const sample = await drawGamePuzzle({ kinds: ["mistake"], excludeIds: ["p0"] }, { next });
    expect(sample.id).toBe("p1");
    expect(next).toHaveBeenCalledWith({ kinds: ["mistake"], excludeIds: ["p0"] });
  });

  it("skips a puzzle whose setup move can't be played", async () => {
    const next = vi
      .fn<(query: { excludeIds?: string[] }) => Promise<GamePuzzle | null>>()
      .mockResolvedValueOnce(puzzle("broken", "e2e5"))
      .mockResolvedValueOnce(puzzle("p2", null));
    expect((await drawGamePuzzle({}, { next })).id).toBe("p2");
    expect(next).toHaveBeenLastCalledWith({ excludeIds: ["broken"] });
  });

  it("fails when none is left", async () => {
    await expect(drawGamePuzzle({}, { next: async () => null })).rejects.toThrow(
      "No puzzles from your games match these filters."
    );
  });
});
