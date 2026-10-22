import { describe, expect, it } from "vitest";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import { migrateMaiaSettings, type MaiaSettingsDeps } from "./maia-settings-migration";

type Row = Pick<EngineConfig, "id" | "name" | "runtime">;

const MAIA1_ROWS: Row[] = [
  { id: "m1100", name: "Maia 1100 (managed)", runtime: "custom-uci" },
  { id: "m1500", name: "Maia 1500 (managed)", runtime: "custom-uci" },
  { id: "sf", name: "Stockfish (managed)", runtime: "custom-uci" },
  // A user's own Maia 1 engine is no managed row: choices on it stay.
  { id: "own", name: "Maia 1500", runtime: "custom-uci" }
];

/** Settings in memory (a key is stored once set) over a fixed engines table. */
function store(stored: Record<string, unknown>, engines: Row[] = MAIA1_ROWS) {
  const values = new Map(Object.entries(stored));
  const deps: MaiaSettingsDeps = {
    getStored: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
    removeStored: (key) => values.delete(key),
    engines: () => engines
  };
  return { deps, values: () => Object.fromEntries(values) };
}

describe("migrateMaiaSettings", () => {
  it("turns Maia 1's one review level into the review's Maia 3 rating, once", () => {
    const { deps, values } = store({ reviewMaiaLevels: [1300] });
    expect(migrateMaiaSettings(deps)).toStrictEqual(["reviewMaiaLevels"]);
    expect(values()).toStrictEqual({ reviewMaiaRating: 1300 });
    expect(migrateMaiaSettings(deps)).toStrictEqual([]);
    expect(values()).toStrictEqual({ reviewMaiaRating: 1300 });
  });

  it("reads each side at its own rating when several (or no) levels were chosen", () => {
    for (const levels of [[1100, 1900], [], null, "garbage"]) {
      const { deps, values } = store({ reviewMaiaLevels: levels });
      migrateMaiaSettings(deps);
      expect(values()).toStrictEqual({});
    }
    // Never chosen (every level): nothing to do.
    const { deps, values } = store({});
    expect(migrateMaiaSettings(deps)).toStrictEqual([]);
    expect(values()).toStrictEqual({});
  });

  it("keeps a Maia 3 review rating already chosen", () => {
    const { deps, values } = store({ reviewMaiaLevels: [1100], reviewMaiaRating: 2000 });
    migrateMaiaSettings(deps);
    expect(values()).toStrictEqual({ reviewMaiaRating: 2000 });
  });

  it("moves Play from a Maia 1 engine to Maia 3 at that rating", () => {
    const engines = [
      ...MAIA1_ROWS,
      { id: "maia3", name: "Maia (managed)", runtime: "maia3" as const }
    ];
    const { deps, values } = store({ playEngineId: "m1500" }, engines);
    expect(migrateMaiaSettings(deps)).toStrictEqual(["playEngineId"]);
    expect(values()).toStrictEqual({ playEngineId: "maia3", playMaiaRating: 1500 });
    expect(migrateMaiaSettings(deps)).toStrictEqual([]);
  });

  it("clears Play's engine when Maia 3 isn't installed yet, keeping the rating for it", () => {
    const { deps, values } = store({ playEngineId: "m1100", playOpponent: "engine" });
    migrateMaiaSettings(deps);
    expect(values()).toStrictEqual({
      playEngineId: null,
      playMaiaRating: 1100,
      playOpponent: "engine"
    });
  });

  it("clears review and analysis engines on a Maia 1 row, and leaves other choices alone", () => {
    const { deps, values } = store({
      defaultEngineId: "m1100",
      analysisEngineId: "m1500",
      playEngineId: "own"
    });
    expect(migrateMaiaSettings(deps)).toStrictEqual(["defaultEngineId", "analysisEngineId"]);
    expect(values()).toStrictEqual({
      defaultEngineId: null,
      analysisEngineId: null,
      playEngineId: "own"
    });

    const kept = store({ defaultEngineId: "sf", analysisEngineId: "gone" });
    expect(migrateMaiaSettings(kept.deps)).toStrictEqual([]);
    expect(kept.values()).toStrictEqual({ defaultEngineId: "sf", analysisEngineId: "gone" });
  });
});
