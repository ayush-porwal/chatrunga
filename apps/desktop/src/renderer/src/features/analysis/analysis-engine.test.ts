import { describe, expect, it } from "vitest";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import { analysisEngineFor, defaultEngineFor, reviewEngineFor, rowEngine } from "./analysis-engine";

const engine = (id: string, patch: Partial<EngineConfig> = {}) =>
  ({ id, name: id, isAvailable: true, isDefault: false, ...patch }) as EngineConfig;

describe("analysis engine", () => {
  const engines = [
    engine("maia"),
    engine("sf", { isDefault: true }),
    engine("gone", { isAvailable: false })
  ];

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

describe("the engine row's engine", () => {
  const engines = [
    engine("sf", { isDefault: true }),
    engine("lc0"),
    engine("broken", { isAvailable: false })
  ];
  const row = (patch: Partial<Parameters<typeof rowEngine>[0]>) =>
    rowEngine({
      engines,
      settings: { analysisEngineId: "lc0" },
      activeEngineId: null,
      engineGame: false,
      ...patch
    })?.id ?? null;

  it("names the engine chosen for analysis, not the one the last search ran on", () => {
    // Off, nothing searched yet.
    expect(row({})).toBe("lc0");
    // Paused (or analysing with nothing to search): the last search was Stockfish's, and Lc0 is
    // chosen since.
    expect(row({ activeEngineId: "sf" })).toBe("lc0");
  });

  it("falls back as analysis does when the chosen engine can't run", () => {
    expect(row({ settings: { analysisEngineId: "broken" }, activeEngineId: "broken" })).toBe("sf");
    expect(row({ settings: { analysisEngineId: null } })).toBe("sf");
    expect(row({ engines: [engine("x", { isAvailable: false })] })).toBeNull();
  });

  it("names an engine game's opponent, whatever analysis would run", () => {
    expect(row({ engineGame: true, activeEngineId: "sf" })).toBe("sf");
    expect(row({ engineGame: true, activeEngineId: null })).toBeNull();
  });
});

describe("review engine", () => {
  it("uses the chosen engine, else the automatic pick, never a human-prediction or unusable one", () => {
    const engines = [
      engine("maia", { isHumanPrediction: true, isDefault: true }),
      engine("sf", { isDefault: true }),
      engine("other")
    ];
    expect(reviewEngineFor(engines, null)?.id).toBe("sf");
    expect(reviewEngineFor(engines, "other")?.id).toBe("other");
    expect(reviewEngineFor(engines, "maia")).toBeNull();
    expect(reviewEngineFor(engines, "gone")).toBeNull();
    expect(reviewEngineFor([engine("sf", { isAvailable: false })], "sf")).toBeNull();
    expect(reviewEngineFor([engine("sf", { isAvailable: false })], null)).toBeNull();
    expect(reviewEngineFor(undefined, null)).toBeNull();
  });
});
