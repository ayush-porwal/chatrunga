import { describe, expect, it } from "vitest";
import { isManagedEngine, MANAGED_ENGINE_SUFFIX } from "./managed";

describe("isManagedEngine", () => {
  it("recognises rows created for managed downloads", () => {
    expect(isManagedEngine({ name: `Stockfish ${MANAGED_ENGINE_SUFFIX}` })).toBe(true);
    expect(isManagedEngine({ name: `Maia 1500 ${MANAGED_ENGINE_SUFFIX}` })).toBe(true);
  });

  it("treats user-added engines as custom", () => {
    expect(isManagedEngine({ name: "Stockfish 17" })).toBe(false);
    expect(isManagedEngine({ name: "Maia 1500" })).toBe(false);
  });
});
