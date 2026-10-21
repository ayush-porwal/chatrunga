import { describe, expect, it } from "vitest";
import { MAX_THINK_MS, MIN_THINK_MS, maiaThinkMs, type MaiaThinkInput } from "./think-time";

/** A seeded random (mulberry32): the same draws on every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const midgame: MaiaThinkInput = {
  remainingMs: 300_000,
  incrementMs: 0,
  moveNumber: 20,
  topProb: 0.4,
  random: () => 0.5
};

describe("maiaThinkMs", () => {
  it("doesn't wait in an untimed game", () => {
    expect(maiaThinkMs({ ...midgame, remainingMs: null })).toBe(0);
  });

  it("spends the time left over the moves to come, with most of the increment", () => {
    // 300 s over 30 moves left, ×1.1 for a top move at 40%, no jitter at 0.5.
    expect(maiaThinkMs(midgame)).toBe(11_000);
    // +0.6 × 2 s of increment.
    expect(maiaThinkMs({ ...midgame, incrementMs: 2000 })).toBe(12_320);
  });

  it("thinks longer in unclear positions and plays a dominant move quickly", () => {
    const at = (topProb: number) => maiaThinkMs({ ...midgame, topProb });
    expect(at(0.1)).toBeGreaterThan(at(0.4));
    expect(at(0.4)).toBeGreaterThan(at(0.8));
    expect(at(0.95)).toBeLessThan(at(0.4) / 2);
    // The factor is continuous across 0.8.
    expect(at(0.81) / at(0.79)).toBeCloseTo(1, 1);
  });

  it("plays opening moves faster than middlegame ones", () => {
    expect(maiaThinkMs({ ...midgame, moveNumber: 1 })).toBeLessThan(
      maiaThinkMs({ ...midgame, moveNumber: 15 }) * 0.5
    );
  });

  it("varies with the draw, within ±25%", () => {
    const random = seeded(42);
    const times = Array.from({ length: 50 }, () => maiaThinkMs({ ...midgame, random }));
    expect(new Set(times).size).toBeGreaterThan(40);
    expect(Math.min(...times)).toBeGreaterThanOrEqual(11_000 * 0.75 - 1);
    expect(Math.max(...times)).toBeLessThanOrEqual(11_000 * 1.25 + 1);
    // Seeded: the same sequence every run.
    const again = seeded(42);
    expect(
      Array.from({ length: 50 }, () => maiaThinkMs({ ...midgame, random: again }))
    ).toStrictEqual(times);
  });

  it("never waits less than the floor while there's time, nor more than the ceiling", () => {
    expect(maiaThinkMs({ ...midgame, remainingMs: 20_000, topProb: 1 })).toBe(MIN_THINK_MS);
    expect(
      maiaThinkMs({ ...midgame, remainingMs: 3_600_000, topProb: 0, random: () => 0.99 })
    ).toBe(MAX_THINK_MS);
  });

  it("never risks the clock: at most 10% of the time left (+ half the increment), half in a scramble", () => {
    expect(maiaThinkMs({ ...midgame, remainingMs: 2000, topProb: 0 })).toBe(200);
    expect(maiaThinkMs({ ...midgame, remainingMs: 2000, incrementMs: 1000, topProb: 0 })).toBe(700);
    // Below the floor's worth of time, the cap wins.
    expect(maiaThinkMs({ ...midgame, remainingMs: 600, incrementMs: 5000, topProb: 0 })).toBe(300);
    const random = seeded(7);
    for (let remainingMs = 100; remainingMs < 120_000; remainingMs *= 1.7) {
      const ms = maiaThinkMs({ ...midgame, remainingMs, incrementMs: 3000, random });
      expect(ms).toBeLessThanOrEqual(remainingMs / 2);
    }
  });
});
