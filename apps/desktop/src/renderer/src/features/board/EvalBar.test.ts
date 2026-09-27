import { describe, expect, it } from "vitest";
import { evalShare } from "./EvalBar";

describe("evalShare", () => {
  it("is even at 0 and grows with White's advantage", () => {
    expect(evalShare({ type: "cp", value: 0 })).toBe(50);
    expect(evalShare({ type: "cp", value: 100 })).toBeGreaterThan(55);
    expect(evalShare({ type: "cp", value: 100 })).toBeLessThan(62);
    expect(evalShare({ type: "cp", value: -300 })).toBeLessThan(30);
    expect(evalShare({ type: "cp", value: 1000 })).toBeGreaterThan(95);
  });

  it("fills the bar for a forced mate", () => {
    expect(evalShare({ type: "mate", value: 3 })).toBe(100);
    expect(evalShare({ type: "mate", value: -2 })).toBe(0);
  });
});
