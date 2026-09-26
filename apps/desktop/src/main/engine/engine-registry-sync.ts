import { engineRepository } from "../db/repositories";
import { getAssetManager, type AssetRecord } from "./asset-manager";
import { isManagedEngine, MANAGED_ENGINE_SUFFIX as MANAGED_SUFFIX } from "@chaturanga/shared/engine/managed";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import { MAIA_RATINGS, maiaRatingForEngine } from "./review-analysis";

/**
 * Sync the asset manager's installed-state snapshot into the desktop's
 * engines table. The asset manager and the engines table are two separate
 * stores:
 *   - asset manager: JSON file at userData/engine-assets.json — tracks
 *     binary paths + checksums for managed downloads + custom paths.
 *   - engines table: SQLite — the source of truth for what
 *     `reviewGame` and friends spawn. Has name, isDefault, isHumanPrediction.
 *
 * When the asset manager installs (download or custom path), this module
 * upserts the corresponding engine row(s) so reviewGame can find them.
 *
 * Sync rules:
 *   stockfish installed →
 *     upsert engine "Stockfish (managed)" with executablePath = stockfish path.
 *     isDefault = true only if no existing engine is default.
 *
 *   lc0 + maia-NNNN both installed →
 *     upsert engine "Maia NNNN (managed)" per Maia weight, with
 *     executablePath = lc0 path, weightsPath = maia-NNNN.pb.gz path,
 *     isHumanPrediction = true. One row per rating.
 *
 *   Asset removed → remove the corresponding managed engine row.
 *
 * Idempotent. Safe to call repeatedly. Identifies managed rows by name
 * suffix `(managed)` — never touches user-configured engines.
 */

export async function syncAssetsToEngineRegistry(): Promise<void> {
  const assets = getAssetManager().getInstalled();
  const existingEngines = engineRepository.list();
  const managedEngines = existingEngines.filter(isManagedEngine);

  // 1. Stockfish
  const stockfishRecord = assets["stockfish"];
  if (isUsable(stockfishRecord)) {
    upsertManagedStockfish(stockfishRecord, existingEngines);
  } else {
    removeManagedByName(managedEngines, `Stockfish ${MANAGED_SUFFIX}`);
  }

  // 2. Maia engines — need lc0 AND a Maia weight to be installed.
  const lc0Record = assets["lc0"];
  const lc0Path = lc0Record && isUsable(lc0Record) ? pathFor(lc0Record) : null;

  for (const rating of MAIA_RATINGS) {
    const maiaRecord = assets[`maia-${rating}` as keyof typeof assets];
    const name = `Maia ${rating} ${MANAGED_SUFFIX}`;
    if (lc0Path && maiaRecord && isUsable(maiaRecord)) {
      upsertManagedMaia(rating, lc0Path, pathFor(maiaRecord), existingEngines);
    } else {
      // Either lc0 missing or this weight missing → remove the corresponding
      // engine row so the user doesn't see a Maia entry that can't actually run.
      removeManagedByName(managedEngines, name);
    }
  }

  // 3. Self-heal flags on existing user-configured engines. Common drift:
  //    - User added Maia via the legacy config form but didn't tick "Human
  //      prediction engine (Maia)". The renderer then says "no Maia configured".
  //    - User deleted whichever engine had isDefault — no engine is default,
  //      the renderer falls back to engines[0] which may be a Maia engine or
  //      just the wrong one.
  // We fix these in place, idempotently. Only writes when a value actually
  // needs to change, so subsequent runs are no-ops.
  autoFixEngineFlags();
}

/**
 * Idempotent flag repair on the engines table:
 *   - A Maia engine (rating tag, or `maia-NNNN` weights/name) that isn't
 *     flagged as human-prediction → flag it. A weights file alone is NOT a
 *     Maia tell: regular Lc0 nets need one too and must stay usable as the
 *     evaluation engine.
 *   - A non-Maia Lc0 engine that an older build flagged as human-prediction
 *     (it flagged anything with weights) → unflag it.
 *   - If no engine has isDefault=true → pick the first non-Maia engine,
 *     preferring one without weights (likely Stockfish).
 */
function autoFixEngineFlags(): void {
  const all = engineRepository.list();
  if (all.length === 0) return;

  for (const e of all) {
    const isMaia = Boolean(maiaRatingForEngine(e));
    if (isMaia && !e.isHumanPrediction) {
      engineRepository.update(e.id, { isHumanPrediction: true });
    } else if (!isMaia && e.isHumanPrediction && e.weightsPath) {
      engineRepository.update(e.id, { isHumanPrediction: false });
    }
  }

  const refreshed = engineRepository.list();
  const hasDefault = refreshed.some((e) => e.isDefault);
  if (!hasDefault) {
    const candidate =
      refreshed.find((e) => !e.isHumanPrediction && !e.weightsPath) ??
      refreshed.find((e) => !e.isHumanPrediction);
    if (candidate) {
      engineRepository.update(candidate.id, { isDefault: true });
    }
  }
}

function isUsable(record: AssetRecord | undefined): boolean {
  if (!record) return false;
  if (record.state !== "installed" && record.state !== "custom") return false;
  return Boolean(pathFor(record));
}

function pathFor(record: AssetRecord): string {
  return record.customPath ?? record.installedPath ?? "";
}

function upsertManagedStockfish(record: AssetRecord, all: EngineConfig[]): void {
  const name = `Stockfish ${MANAGED_SUFFIX}`;
  const existing = all.find((e) => e.name === name);
  const path = pathFor(record);
  if (existing) {
    if (existing.executablePath !== path) {
      engineRepository.update(existing.id, { executablePath: path });
    }
    return;
  }
  // First install — make it default if nothing else is.
  const isDefault = !all.some((e) => e.isDefault);
  engineRepository.create({
    name,
    executablePath: path,
    args: [],
    isDefault,
    isHumanPrediction: false
  });
}

function upsertManagedMaia(
  rating: NonNullable<EngineConfig["maiaRating"]>,
  lc0Path: string,
  weightsPath: string,
  all: EngineConfig[]
): void {
  const name = `Maia ${rating} ${MANAGED_SUFFIX}`;
  const existing = all.find((e) => e.name === name);
  if (existing) {
    const patch: Partial<{ executablePath: string; weightsPath: string; maiaRating: NonNullable<EngineConfig["maiaRating"]> }> = {};
    if (existing.executablePath !== lc0Path) patch.executablePath = lc0Path;
    if (existing.weightsPath !== weightsPath) patch.weightsPath = weightsPath;
    if (existing.maiaRating !== rating) patch.maiaRating = rating;
    if (Object.keys(patch).length > 0) {
      engineRepository.update(existing.id, patch);
    }
    return;
  }
  engineRepository.create({
    name,
    executablePath: lc0Path,
    weightsPath,
    args: [],
    isDefault: false,
    isHumanPrediction: true,
    maiaRating: rating
  });
}

function removeManagedByName(managed: EngineConfig[], name: string): void {
  const target = managed.find((e) => e.name === name);
  if (!target) return;
  engineRepository.remove(target.id);
}
