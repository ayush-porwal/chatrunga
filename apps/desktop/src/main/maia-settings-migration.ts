/**
 * Settings migration for Maia 3 (which replaced Maia 1's five managed engines, one per rating).
 * Runs at startup before the window loads and before the engine registry sync removes Maia 1's
 * rows (it reads them to know their ratings). Idempotent: once it has run nothing it reads is
 * left to change.
 *
 * - `reviewMaiaLevels` (Maia 1's levels for reviews, no longer a setting): exactly one level
 *   becomes the review's Maia rating (`reviewMaiaRating`); any other choice reads each side at its
 *   own rating (null). The old key is then deleted.
 * - Play's engine (`playEngineId`) on a Maia 1 row: Maia's rating becomes that level
 *   (`playMaiaRating`), and Play points at the Maia 3 row if it exists, else at nothing (Play then
 *   falls back to the default engine).
 * - The review / analysis engines (`defaultEngineId`, `analysisEngineId`) on a Maia 1 row are
 *   cleared: Maia 3 evaluates nothing, so the default engine takes over.
 */
import { MAIA1_MANAGED_NAME } from "@chaturanga/shared/engine/managed";
import { nearestMaia3Rating } from "@chaturanga/shared/engine/maia3";
import type { AppSettings, LegacySettingKey } from "@chaturanga/shared/types/settings";
import type { EngineConfig } from "@chaturanga/shared/types/engine";

type MigratedKey =
  | "reviewMaiaRating"
  | "playEngineId"
  | "playMaiaRating"
  | "defaultEngineId"
  | "analysisEngineId";

export type MaiaSettingsDeps = {
  /** The stored value, undefined when none is stored. */
  getStored: (key: MigratedKey | LegacySettingKey) => unknown;
  set: <K extends MigratedKey>(key: K, value: AppSettings[K]) => void;
  /** Deletes an old key that is no longer a setting. */
  removeStored: (key: LegacySettingKey) => void;
  /** The engines table as it is before the registry sync. */
  engines: () => Pick<EngineConfig, "id" | "name" | "runtime">[];
};

/** Maia 1's single review level as the review's Maia 3 rating; returns whether it changed. */
function migrateReviewLevels(deps: MaiaSettingsDeps): boolean {
  const levels = deps.getStored("reviewMaiaLevels");
  if (levels === undefined) return false;
  const chosen: readonly unknown[] = Array.isArray(levels) ? levels : [];
  const only = chosen.length === 1 ? chosen[0] : undefined;
  if (typeof only === "number" && deps.getStored("reviewMaiaRating") === undefined)
    deps.set("reviewMaiaRating", nearestMaia3Rating(only));
  deps.removeStored("reviewMaiaLevels");
  return true;
}

/** Engine choices on a Maia 1 row moved to Maia 3 (Play) or cleared; returns the keys changed. */
function migrateEngineChoices(deps: MaiaSettingsDeps): MigratedKey[] {
  const engines = deps.engines();
  const maia1Rating = (id: unknown): number | null => {
    const name = engines.find((engine) => engine.id === id)?.name ?? "";
    const rating = MAIA1_MANAGED_NAME.exec(name)?.[1];
    return rating ? Number(rating) : null;
  };
  const changed: MigratedKey[] = [];
  const playRating = maia1Rating(deps.getStored("playEngineId"));
  if (playRating !== null) {
    if (deps.getStored("playMaiaRating") === undefined) deps.set("playMaiaRating", playRating);
    const maia3 = engines.find((engine) => engine.runtime === "maia3");
    deps.set("playEngineId", maia3?.id ?? null);
    changed.push("playEngineId");
  }
  for (const key of ["defaultEngineId", "analysisEngineId"] as const) {
    if (maia1Rating(deps.getStored(key)) === null) continue;
    deps.set(key, null);
    changed.push(key);
  }
  return changed;
}

/** Runs the migration; returns the settings it changed (empty once it has run). */
export function migrateMaiaSettings(deps: MaiaSettingsDeps): (MigratedKey | LegacySettingKey)[] {
  const changed = migrateEngineChoices(deps);
  return migrateReviewLevels(deps) ? ["reviewMaiaLevels", ...changed] : changed;
}
