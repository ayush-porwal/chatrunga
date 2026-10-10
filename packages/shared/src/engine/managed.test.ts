import { describe, expect, it } from "vitest";
import { engineDisplayName, isManagedEngine, MANAGED_ENGINE_SUFFIX } from "./managed";

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

describe("engineDisplayName", () => {
  it("drops the managed marker and keeps every other name as it is", () => {
    expect(engineDisplayName(`Stockfish ${MANAGED_ENGINE_SUFFIX}`)).toBe("Stockfish");
    expect(engineDisplayName("Maia 1500 (managed)")).toBe("Maia 1500");
    // A player name saved by an older build, with text after the marker.
    expect(engineDisplayName("Stockfish (managed) 1000 ms")).toBe("Stockfish 1000 ms");
    expect(engineDisplayName("Stockfish 17")).toBe("Stockfish 17");
    expect(engineDisplayName("Lc0 (custom)")).toBe("Lc0 (custom)");
  });
});
