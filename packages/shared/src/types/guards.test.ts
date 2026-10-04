import { describe, expect, it } from "vitest";
import { isOneOf, isRecord } from "./guards";

describe("isRecord", () => {
  it("accepts plain objects, not null, arrays or primitives", () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    expect([null, [], "x", 1, undefined].some(isRecord)).toBe(false);
  });
});

describe("isOneOf", () => {
  it("accepts the listed members only, by identity", () => {
    const sizes = [16, 32] as const;
    expect(isOneOf(sizes, 32)).toBe(true);
    expect(isOneOf(sizes, "32")).toBe(false);
    expect(isOneOf(["a", "b"], "c")).toBe(false);
  });
});
