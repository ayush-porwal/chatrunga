import { describe, expect, it } from "vitest";
import { START_FEN } from "../chess/position";
import type { Maia3Output } from "./maia3";
import { parseMaiaHostMessage, sampleMaia3Move, validMaia3Output } from "./maia3-host";

/** A seeded uniform [0, 1) generator (mulberry32), so a sampling test is repeatable. */
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

describe("sampleMaia3Move", () => {
  it("draws each move in proportion to its probability", () => {
    const policy = { e2e4: 0.5, d2d4: 0.3, g1f3: 0.15, a2a3: 0.05 };
    const random = seeded(42);
    const draws = Array.from({ length: 20_000 }, () => sampleMaia3Move(policy, random));
    for (const [uci, prob] of Object.entries(policy)) {
      const share = draws.filter((move) => move === uci).length / draws.length;
      expect(Math.abs(share - prob)).toBeLessThan(0.015);
    }
    expect(draws).not.toContain(null);
  });

  it("picks by cumulative share, so the draw maps to a move deterministically", () => {
    const policy = { e2e4: 0.6, d2d4: 0.4 };
    expect(sampleMaia3Move(policy, () => 0)).toBe("e2e4");
    expect(sampleMaia3Move(policy, () => 0.59)).toBe("e2e4");
    expect(sampleMaia3Move(policy, () => 0.61)).toBe("d2d4");
    // A policy that sums a little under 1 (rounding) still covers the whole draw.
    expect(sampleMaia3Move({ e2e4: 0.5, d2d4: 0.4999 }, () => 0.99999)).toBe("d2d4");
  });

  it("never draws a move without a positive probability, and has none to draw from nothing", () => {
    expect(sampleMaia3Move({ e2e4: 0, d2d4: 1, a2a3: Number.NaN }, () => 0)).toBe("d2d4");
    expect(sampleMaia3Move({}, () => 0.5)).toBeNull();
    expect(sampleMaia3Move({ e2e4: 0 }, () => 0.5)).toBeNull();
  });
});

describe("validMaia3Output", () => {
  const output: Maia3Output = { policy: { d2d4: 0.3, e2e4: 0.7 }, value: 0.52 };

  it("keeps an output whose moves are legal, sorted by probability", () => {
    // In order: the likeliest move first.
    expect(JSON.stringify(validMaia3Output(START_FEN, output))).toBe(
      '{"policy":{"e2e4":0.7,"d2d4":0.3},"value":0.52}'
    );
  });

  it("refuses an illegal or unreadable move", () => {
    expect(validMaia3Output(START_FEN, { policy: { e2e5: 1 }, value: 0.5 })).toBeNull();
    expect(validMaia3Output(START_FEN, { policy: { castle: 1 }, value: 0.5 })).toBeNull();
    // A promotion suffix on a move that doesn't promote.
    expect(validMaia3Output(START_FEN, { policy: { e2e4q: 1 }, value: 0.5 })).toBeNull();
  });

  it("refuses probabilities and values that are not finite numbers in [0, 1]", () => {
    expect(validMaia3Output(START_FEN, { policy: { e2e4: Number.NaN }, value: 0.5 })).toBeNull();
    expect(validMaia3Output(START_FEN, { policy: { e2e4: 1.2 }, value: 0.5 })).toBeNull();
    expect(
      validMaia3Output(START_FEN, { policy: { e2e4: 1.1, d2d4: -0.1 }, value: 0.5 })
    ).toBeNull();
    expect(validMaia3Output(START_FEN, { ...output, value: 1.01 })).toBeNull();
    expect(validMaia3Output(START_FEN, { ...output, value: Number.NaN })).toBeNull();
  });

  it("refuses a policy that is not a distribution over the position's moves", () => {
    expect(validMaia3Output(START_FEN, { policy: { e2e4: 0.4 }, value: 0.5 })).toBeNull();
    expect(validMaia3Output(START_FEN, { policy: {}, value: 0.5 })).toBeNull();
  });

  it("accepts an empty policy only where there is no legal move", () => {
    const mated = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";
    expect(validMaia3Output(mated, { policy: {}, value: 0 })).toStrictEqual({
      policy: {},
      value: 0
    });
    expect(validMaia3Output(mated, { policy: { e2e4: 1 }, value: 0 })).toBeNull();
  });

  it("refuses an unreadable position", () => {
    expect(validMaia3Output("not a fen", output)).toBeNull();
  });
});

describe("parseMaiaHostMessage", () => {
  it("reads the host's status, with its progress or error", () => {
    expect(parseMaiaHostMessage({ type: "status", status: "ready" })).toStrictEqual({
      type: "status",
      status: "ready"
    });
    expect(
      parseMaiaHostMessage({ type: "status", status: "downloading", progress: 40 })
    ).toStrictEqual({
      type: "status",
      status: "downloading",
      progress: 40
    });
    expect(
      parseMaiaHostMessage({ type: "status", status: "error", error: "no WebGL" })
    ).toStrictEqual({
      type: "status",
      status: "error",
      error: "no WebGL"
    });
  });

  it("reads results and request errors", () => {
    const result = [{ policy: { e2e4: 0.7, d2d4: 0.3 }, value: 0.52 }];
    expect(parseMaiaHostMessage({ type: "result", id: 3, result })).toStrictEqual({
      type: "result",
      id: 3,
      result
    });
    expect(
      parseMaiaHostMessage({ type: "error", id: 4, message: "inference failed" })
    ).toStrictEqual({
      type: "error",
      id: 4,
      message: "inference failed"
    });
  });

  it("refuses anything else", () => {
    const bad: unknown[] = [
      null,
      "ready",
      [],
      { type: "progress", progress: 3 },
      { type: "status", status: "done" },
      { type: "status", status: "downloading", progress: "40" },
      { type: "status", status: "error", error: 5 },
      { type: "result", id: -1, result: [] },
      { type: "result", id: 1.5, result: [] },
      { type: "result", id: 1, result: {} },
      { type: "result", id: 1, result: [{ policy: { e2e4: "0.5" }, value: 0.5 }] },
      { type: "result", id: 1, result: [{ policy: [], value: 0.5 }] },
      { type: "result", id: 1, result: [{ policy: {}, value: Number.NaN }] },
      { type: "error", id: 1 },
      { type: "error", message: "x" }
    ];
    for (const raw of bad) expect(parseMaiaHostMessage(raw)).toBeNull();
  });
});
