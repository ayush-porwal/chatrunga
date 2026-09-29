import { describe, expect, it } from "vitest";
import { createUciIdentity, isHumanPredictionEngine, readHandshakeLine } from "./uci-handshake";

describe("readHandshakeLine", () => {
  it("collects the engine's id and options until uciok", () => {
    const identity = createUciIdentity();
    const lines = ["id name Lc0 v0.31", "id author The LCZero Authors / Maia", "option name MultiPV type spin default 1", "option name Hash type spin"];
    expect(lines.map((line) => readHandshakeLine(identity, line))).toEqual([false, false, false, false]);
    expect(readHandshakeLine(identity, "uciok")).toBe(true);
    expect(identity).toMatchObject({ name: "Lc0 v0.31", author: "The LCZero Authors / Maia" });
    expect([...identity.options]).toEqual(["MultiPV", "Hash"]);
    expect(isHumanPredictionEngine(identity)).toBe(true);
    expect(isHumanPredictionEngine({ name: "Stockfish 17", options: new Set() })).toBe(false);
  });
});
