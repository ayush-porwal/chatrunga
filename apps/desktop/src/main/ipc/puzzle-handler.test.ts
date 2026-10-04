import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordPuzzleAttemptInput } from "@chaturanga/shared/types/puzzle-rating";

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
vi.mock("electron", () => ({
  app: { getPath: () => "/nonexistent" },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) =>
      handlers.set(channel, handler)
  }
}));

/** Each record() call, by attempt id; ids in `busyOnce` find the database busy on their first try. */
const recorded: string[] = [];
const busyOnce = new Set<string>();
const failing = new Set<string>();
vi.mock("../db/puzzle-attempts", () => ({
  puzzleAttemptRepository: {
    record: (input: RecordPuzzleAttemptInput) => {
      recorded.push(input.attemptId);
      if (busyOnce.delete(input.attemptId))
        throw Object.assign(new Error("database is locked"), { errcode: 5 });
      if (failing.has(input.attemptId)) throw new Error("disk I/O error");
      return { attemptId: input.attemptId };
    }
  }
}));

const { registerPuzzleIpc } = await import("./puzzle-handler");
registerPuzzleIpc();

function recordAttempt(attemptId: string): Promise<unknown> {
  const input: RecordPuzzleAttemptInput = {
    attemptId,
    puzzleId: `puzzle-${attemptId}`,
    databaseId: "db",
    sourceId: "lichess-puzzles",
    outcome: "solved",
    puzzleRating: 1500,
    puzzleRatingDeviation: 75,
    themes: [],
    wrongMoveCount: 0,
    solutionViewed: false,
    startedAt: 1_000,
    decidedAt: 2_000,
    completedAt: 2_000
  };
  return Promise.resolve(handlers.get("puzzles:recordAttempt")!(null, input));
}

describe("puzzles:recordAttempt", () => {
  beforeEach(() => {
    recorded.length = 0;
    busyOnce.clear();
    failing.clear();
  });

  it("records attempts one at a time in arrival order: one waiting out a busy retry goes before a later one", async () => {
    busyOnce.add("early");
    const early = recordAttempt("early");
    const later = recordAttempt("later");
    await expect(Promise.all([early, later])).resolves.toEqual([
      { attemptId: "early" },
      { attemptId: "later" }
    ]);
    expect(recorded).toEqual(["early", "early", "later"]);
  });

  it("a recording that fails doesn't hold up the next", async () => {
    failing.add("broken");
    const broken = recordAttempt("broken");
    const next = recordAttempt("next");
    await expect(broken).rejects.toThrow(/disk I\/O error/);
    await expect(next).resolves.toEqual({ attemptId: "next" });
    expect(recorded).toEqual(["broken", "next"]);
  });

  it("rejects an invalid attempt without recording it", async () => {
    expect(() => handlers.get("puzzles:recordAttempt")!(null, { attemptId: "x" })).toThrow(
      /Invalid puzzle outcome/
    );
    expect(recorded).toEqual([]);
  });
});
