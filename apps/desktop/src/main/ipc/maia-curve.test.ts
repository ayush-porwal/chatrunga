import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAIA3_RATINGS, type Maia3Output } from "@chaturanga/shared/engine/maia3";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const move = (nodeId: string) => ({
  nodeId,
  ply: 1,
  fenBefore: START,
  fenAfter: `${START} ${nodeId}`,
  playedMove: "e2e4",
  bestMove: "d2d4"
});
const review = { maia: { model: "maia3" }, moves: ["a", "b", "c", "d"].map(move) };
const answer: Maia3Output = { policy: { e2e4: 0.6, d2d4: 0.4 }, value: 0.5 };

/** Maia 3's requests, each answered by `finish` (in the order they were sent). */
const maia = vi.hoisted(() => ({
  sent: [] as { fen: string }[][],
  finish: [] as (() => void)[]
}));
vi.mock("../db/repositories", () => ({
  gameRepository: { getReview: () => review, saveMaiaCurve: () => true }
}));
vi.mock("../logger", () => ({ logger: { warn: () => {} } }));
vi.mock("../maia", () => ({
  getMaia3Evaluator: () => ({
    isInstalled: () => true,
    dispose: () => {},
    evaluate: (queries: { fen: string }[]) =>
      new Promise((resolve) => {
        maia.sent.push(queries);
        maia.finish.push(() => resolve(queries.map(() => answer)));
      })
  })
}));

const { maiaCurve } = await import("./maia-curve");
const curveOf = (nodeId: string) => maiaCurve({ gameId: "g", reviewId: "r", nodeId });

describe("maiaCurve", () => {
  beforeEach(() => {
    maia.sent.length = 0;
    maia.finish.length = 0;
  });

  it("sends an analysis's curves to Maia one at a time, the newest waiting one replacing the others", async () => {
    const first = curveOf("a");
    const skipped = curveOf("b");
    // Asked twice for one move: one request.
    expect(curveOf("b")).toBe(skipped);
    const skippedFailure = skipped.catch((error: unknown) => error);
    const shown = curveOf("c");
    expect(String(await skippedFailure)).toMatch(/newer rating curve/);
    await vi.waitFor(() => expect(maia.sent).toHaveLength(1));

    maia.finish[0]();
    await expect(first).resolves.toHaveLength(MAIA3_RATINGS.length);
    await vi.waitFor(() => expect(maia.sent).toHaveLength(2));
    maia.finish[1]();
    const curve = await shown;
    expect(curve.map((prediction) => prediction.rating)).toStrictEqual([...MAIA3_RATINGS]);

    // The lane is free again: the next curve goes straight to Maia.
    const next = curveOf("d");
    await vi.waitFor(() => expect(maia.sent).toHaveLength(3));
    maia.finish[2]();
    await expect(next).resolves.toHaveLength(MAIA3_RATINGS.length);
  });

  it("keeps other analyses' curves apart", async () => {
    const one = curveOf("a");
    const other = maiaCurve({ gameId: "g", reviewId: "other", nodeId: "a" });
    await vi.waitFor(() => expect(maia.sent).toHaveLength(2));
    for (const finish of maia.finish) finish();
    await expect(Promise.all([one, other])).resolves.toHaveLength(2);
  });
});
