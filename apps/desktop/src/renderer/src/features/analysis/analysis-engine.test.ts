import { describe, expect, it } from "vitest";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import { analysisEngineFor, defaultEngineFor } from "./analysis-engine";

const engine = (id: string, patch: Partial<EngineConfig> = {}) => ({ id, name: id, isAvailable: true, isDefault: false, ...patch }) as EngineConfig;

describe("analysis engine", () => {
  const engines = [engine("maia"), engine("sf", { isDefault: true }), engine("gone", { isAvailable: false })];

  it("falls back to the default engine, else the first", () => {
    expect(defaultEngineFor(engines)).toBe("sf");
    expect(defaultEngineFor([engine("a"), engine("b")])).toBe("a");
    expect(defaultEngineFor(undefined)).toBeNull();
  });

  it("uses the chosen engine while it's installed and usable, else a usable default", () => {
    expect(analysisEngineFor(engines, "maia")).toBe("maia");
    expect(analysisEngineFor(engines, "gone")).toBe("sf");
    expect(analysisEngineFor(engines, "removed")).toBe("sf");
    expect(analysisEngineFor(engines, null)).toBe("sf");
    // The default engine itself can't run: the first usable one, never an unusable one.
    const brokenDefault = [engine("sf", { isDefault: true, isAvailable: false }), engine("lc0")];
    expect(analysisEngineFor(brokenDefault, null)).toBe("lc0");
    expect(analysisEngineFor([engine("x", { isAvailable: false })], null)).toBeNull();
  });
});
