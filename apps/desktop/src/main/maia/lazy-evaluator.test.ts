import { describe, expect, it, vi } from "vitest";
import type { Maia3Evaluator, Maia3Output } from "@chaturanga/shared/engine/maia3";
import { LazyEvaluator } from "./lazy-evaluator";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const query = { fen: START, eloSelf: 1500, eloOppo: 1500 };
const output: Maia3Output = { policy: { e2e4: 1 }, value: 0.5 };

function innerEvaluator() {
  const evaluate = vi.fn(() => Promise.resolve([output]));
  const dispose = vi.fn();
  const evaluator: Maia3Evaluator = { isInstalled: () => true, evaluate, dispose };
  return { evaluator, evaluate, dispose };
}

describe("LazyEvaluator", () => {
  it("loads its evaluator once, on the first request, and answers through it", async () => {
    const inner = innerEvaluator();
    const load = vi.fn(() => Promise.resolve(inner.evaluator));
    const lazy = new LazyEvaluator({ load, isInstalled: () => false });

    // Nothing is loaded to say whether Maia 3 is installed, or to dispose.
    expect(lazy.isInstalled()).toBe(false);
    lazy.dispose();
    expect(load).not.toHaveBeenCalled();

    const signal = new AbortController().signal;
    const [first, second] = await Promise.all([
      lazy.evaluate([query], { priority: "game", signal }),
      lazy.evaluate([query])
    ]);
    expect(first).toStrictEqual([output]);
    expect(second).toStrictEqual([output]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(inner.evaluate).toHaveBeenCalledWith([query], { priority: "game", signal });

    lazy.dispose();
    expect(inner.dispose).toHaveBeenCalledTimes(1);
  });

  it("tries the load again after one failed", async () => {
    const inner = innerEvaluator();
    const load = vi
      .fn<() => Promise<Maia3Evaluator>>()
      .mockRejectedValueOnce(new Error("chunk missing"))
      .mockResolvedValue(inner.evaluator);
    const lazy = new LazyEvaluator({ load, isInstalled: () => true });

    await expect(lazy.evaluate([query])).rejects.toThrow(/chunk missing/);
    await expect(lazy.evaluate([query])).resolves.toStrictEqual([output]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("disposes an evaluator that finishes loading after a dispose, failing its requests; the next request loads again", async () => {
    const stale = innerEvaluator();
    const fresh = innerEvaluator();
    let finishLoad: (evaluator: Maia3Evaluator) => void = () => undefined;
    const load = vi
      .fn<() => Promise<Maia3Evaluator>>()
      .mockReturnValueOnce(new Promise((resolve) => (finishLoad = resolve)))
      .mockResolvedValue(fresh.evaluator);
    const lazy = new LazyEvaluator({ load, isInstalled: () => true });

    const waiting = lazy.evaluate([query]);
    lazy.dispose(); // The window closes while Maia's code is still loading.
    finishLoad(stale.evaluator);
    await expect(waiting).rejects.toThrow(/closed while it loaded/);
    expect(stale.dispose).toHaveBeenCalledTimes(1);
    expect(stale.evaluate).not.toHaveBeenCalled();

    // Not dead: the recreated window's request loads Maia again.
    await expect(lazy.evaluate([query])).resolves.toStrictEqual([output]);
    expect(load).toHaveBeenCalledTimes(2);
    expect(fresh.evaluate).toHaveBeenCalledTimes(1);
  });
});
