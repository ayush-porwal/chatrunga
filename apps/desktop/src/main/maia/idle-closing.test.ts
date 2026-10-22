import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Maia3Evaluator, Maia3Output } from "@chaturanga/shared/engine/maia3";
import { IdleClosingEvaluator } from "./idle-closing";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const query = { fen: START, eloSelf: 1500, eloOppo: 1500 };
const IDLE_MS = 300_000;

/** An evaluator whose answers the test gives (one pending request at a time). */
function controlledEvaluator() {
  let answer: ((outputs: Maia3Output[]) => void) | null = null;
  let fail: ((error: Error) => void) | null = null;
  const dispose = vi.fn();
  const inner: Maia3Evaluator = {
    isInstalled: () => true,
    evaluate: vi.fn(
      () =>
        new Promise<Maia3Output[]>((resolve, reject) => {
          answer = resolve;
          fail = reject;
        })
    ),
    dispose
  };
  return {
    inner,
    dispose,
    answer: () => answer?.([{ policy: { e2e4: 1 }, value: 0.5 }]),
    fail: () => fail?.(new Error("host stopped"))
  };
}

describe("IdleClosingEvaluator", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("closes the host once nothing has been asked for the idle time", async () => {
    const { inner, dispose, answer } = controlledEvaluator();
    const evaluator = new IdleClosingEvaluator(inner, IDLE_MS);
    const result = evaluator.evaluate([query]);
    // Still answering: no idle time counts.
    await vi.advanceTimersByTimeAsync(IDLE_MS * 2);
    expect(dispose).not.toHaveBeenCalled();

    answer();
    await result;
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    expect(dispose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("a new request restarts the idle time, a failed one counts as finished", async () => {
    const { inner, dispose, answer, fail } = controlledEvaluator();
    const evaluator = new IdleClosingEvaluator(inner, IDLE_MS);
    const first = evaluator.evaluate([query]);
    answer();
    await first;
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1000);

    const second = evaluator.evaluate([query]);
    fail();
    await expect(second).rejects.toThrow("host stopped");
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    expect(dispose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("disposing closes the host now and drops the idle timer", async () => {
    const { inner, dispose, answer } = controlledEvaluator();
    const evaluator = new IdleClosingEvaluator(inner, IDLE_MS);
    const result = evaluator.evaluate([query]);
    answer();
    await result;
    evaluator.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
