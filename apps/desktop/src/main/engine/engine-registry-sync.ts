import { engineRepository } from "../db/repositories";
import { getAssetManager, type AssetRecord } from "./asset-manager";
import {
  isManagedEngine,
  MAIA1_MANAGED_NAME,
  MANAGED_ENGINE_SUFFIX as MANAGED_SUFFIX
} from "@chaturanga/shared/engine/managed";
import { basename } from "node:path";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import { maia3ModelPath } from "../maia/model-path";

const LC0_ENGINE_NAME = `Lc0 ${MANAGED_SUFFIX}`;
/** The one managed Maia: Maia 3 at every rating, run in its host window (maia/index.ts). */
const MAIA_ENGINE_NAME = `Maia ${MANAGED_SUFFIX}`;

/**
 * The managed Lc0 this run made the default by itself (nothing else was default), not the user.
 * Onboarding installs assets separately and syncs after each, so Lc0 + its network can land
 * before Stockfish; Stockfish then takes the default over. The engines table records only the
 * flag, so a default the user set ("Set as default") is never in here and always stays. Not
 * persisted: after a restart an Lc0 default counts as the user's.
 */
let automaticLc0DefaultId: string | null = null;

/**
 * Sync the asset manager's installed-state snapshot into the desktop's
 * engines table. The asset manager and the engines table are two separate
 * stores:
 *   - asset manager: JSON file at userData/engine-assets.json — tracks
 *     binary paths + checksums for managed downloads + custom paths.
 *   - engines table: SQLite — the source of truth for what
 *     `reviewGame` and friends run. Has name, runtime, isDefault, isHumanPrediction.
 *
 * When the asset manager installs (download or custom path), this module
 * upserts the corresponding engine row(s) so reviewGame can find them.
 *
 * Sync rules:
 *   stockfish installed →
 *     upsert engine "Stockfish (managed)" with executablePath = stockfish path.
 *     isDefault = true only if no existing engine is default, or the default is the managed Lc0
 *     this run made the default by itself.
 *
 *   lc0 + lc0-network both installed (downloaded or the user's own files) →
 *     upsert engine "Lc0 (managed)" with executablePath = lc0 path, weightsPath = network path.
 *     Not human-prediction; isDefault = true only if no existing engine is default, and then
 *     only until a managed Stockfish is installed (see automaticLc0DefaultId).
 *
 *   maia3 installed (or the e2e fixture on, maia/model-path.ts) →
 *     upsert the one engine "Maia (managed)" with runtime = "maia3", executablePath = the model
 *     file, isHumanPrediction = true, no rating (Play picks Maia's rating per game).
 *
 *   Maia 1's rows ("Maia 1100 (managed)" … "Maia 1900 (managed)", Lc0 on Maia weights) are
 *   removed: Maia 3 replaced them (their weights are deleted by the asset manager).
 *
 *   Asset removed → remove the corresponding managed engine row. Resolves to the removed rows'
 *   ids, so the caller can delete their picture copies (see engine-images.ts).
 *
 * Idempotent. Safe to call repeatedly. Identifies managed rows by name
 * suffix `(managed)` (the Maia row by its runtime, see isManagedMaiaRow) — never touches
 * user-configured engines.
 */

export async function syncAssetsToEngineRegistry(): Promise<string[]> {
  const assets = getAssetManager().getInstalled();
  const existingEngines = engineRepository.list();
  const managedEngines = existingEngines.filter(isManagedEngine);
  const removed: string[] = [];
  const removeManagedByName = (name: string): void => {
    const target = managedEngines.find((e) => e.name === name);
    if (!target) return;
    engineRepository.remove(target.id);
    removed.push(target.id);
  };

  // 1. Stockfish
  const stockfishRecord = assets["stockfish"];
  if (isUsable(stockfishRecord)) {
    upsertManagedStockfish(stockfishRecord, existingEngines);
  } else {
    removeManagedByName(`Stockfish ${MANAGED_SUFFIX}`);
  }

  // 2. Lc0 on its own network — needs lc0 AND the network.
  const lc0Record = assets["lc0"];
  const lc0Path = isUsable(lc0Record) ? pathFor(lc0Record) : null;
  const networkRecord = assets["lc0-network"];
  if (lc0Path && isUsable(networkRecord)) {
    upsertManagedLc0(lc0Path, pathFor(networkRecord), existingEngines);
  } else {
    removeManagedByName(LC0_ENGINE_NAME);
  }

  // 3. Maia 3 — one row for every rating.
  const modelPath = maia3ModelPath();
  if (modelPath) {
    upsertManagedMaia(modelPath, existingEngines);
  } else {
    for (const engine of existingEngines.filter(isManagedMaiaRow)) {
      engineRepository.remove(engine.id);
      removed.push(engine.id);
    }
  }

  // 4. Maia 1's rows, replaced by Maia 3.
  for (const engine of managedEngines) {
    if (MAIA1_MANAGED_NAME.test(engine.name)) removeManagedByName(engine.name);
  }

  // 5. Self-heal flags on existing user-configured engines. Common drift:
  //    - User added Maia via the legacy config form but didn't tick "Human
  //      prediction engine (Maia)". The renderer then says "no Maia configured".
  //    - User deleted whichever engine had isDefault — no engine is default,
  //      the renderer falls back to engines[0] which may be a Maia engine or
  //      just the wrong one.
  // We fix these in place, idempotently. Only writes when a value actually
  // needs to change, so subsequent runs are no-ops.
  autoFixEngineFlags();
  return removed;
}

/**
 * Idempotent flag repair on the engines table. The human-prediction flag no longer picks what
 * Review runs (that is Maia 3 alone); it keeps an engine out of the evaluation roles (the review
 * engine, live analysis, the default engine, "an engine is ready"). A user's own Maia 1 (Lc0 on
 * a Maia net) stays an ordinary UCI engine to play against, but it is no evaluator (one node,
 * human moves, no real eval), so it keeps the flag:
 *   - A Maia engine (the Maia 3 row, or "maia" in its weights/name) that isn't
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
    const isMaia = isMaiaEngine(e);
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
      if (candidate.name === LC0_ENGINE_NAME) automaticLc0DefaultId = candidate.id;
    }
  }
}

/**
 * Maia: the Maia 3 row, or a Maia 1 engine ("maia" in its name or its weights file's name; the
 * asset manager refuses a Maia net as Lc0's own network for this reason).
 */
function isMaiaEngine(engine: EngineConfig): boolean {
  if (engine.runtime === "maia3") return true;
  return /maia/i.test(engine.name) || /maia/i.test(basename(engine.weightsPath ?? ""));
}

function isUsable(record: AssetRecord): boolean {
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
  // First install — make it default if nothing else is, or only an Lc0 the app picked by itself.
  const current = all.find((e) => e.isDefault);
  const isDefault = !current || current.id === automaticLc0DefaultId;
  engineRepository.create({
    name,
    executablePath: path,
    args: [],
    isDefault,
    isHumanPrediction: false
  });
}

function upsertManagedLc0(lc0Path: string, weightsPath: string, all: EngineConfig[]): void {
  const existing = all.find((e) => e.name === LC0_ENGINE_NAME);
  if (existing) {
    const patch: Partial<Pick<EngineConfig, "executablePath" | "weightsPath">> = {};
    if (existing.executablePath !== lc0Path) patch.executablePath = lc0Path;
    if (existing.weightsPath !== weightsPath) patch.weightsPath = weightsPath;
    if (Object.keys(patch).length > 0) engineRepository.update(existing.id, patch);
    return;
  }
  // Read again: a Stockfish created by this same sync is the default, and stays it.
  const isDefault = !engineRepository.list().some((e) => e.isDefault);
  const created = engineRepository.create({
    name: LC0_ENGINE_NAME,
    executablePath: lc0Path,
    weightsPath,
    args: [],
    isDefault,
    isHumanPrediction: false
  });
  if (isDefault) automaticLc0DefaultId = created.id;
}

/**
 * The managed Maia row: the one running Maia 3, or (to repair it) one named as it whose
 * "executable" is an ONNX model, which no UCI engine is. A user's own engine that happens to
 * carry the name is never taken over.
 */
function isManagedMaiaRow(engine: EngineConfig): boolean {
  return (
    engine.runtime === "maia3" ||
    (engine.name === MAIA_ENGINE_NAME && /\.onnx$/i.test(engine.executablePath))
  );
}

function upsertManagedMaia(modelPath: string, all: EngineConfig[]): void {
  const existing = all.find((e) => e.runtime === "maia3") ?? all.find((e) => isManagedMaiaRow(e));
  if (existing) {
    const patch: { executablePath?: string; runtime?: "maia3" } = {};
    if (existing.executablePath !== modelPath) patch.executablePath = modelPath;
    if (existing.runtime !== "maia3") patch.runtime = "maia3";
    if (Object.keys(patch).length > 0) engineRepository.update(existing.id, patch);
    return;
  }
  engineRepository.create({
    name: MAIA_ENGINE_NAME,
    executablePath: modelPath,
    args: [],
    isDefault: false,
    isHumanPrediction: true,
    runtime: "maia3"
  });
}
