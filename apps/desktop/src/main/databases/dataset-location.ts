import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { externalDatabaseSources } from "@chaturanga/shared/types/database";

/**
 * Where downloaded datasets live. Not `<userData>/databases`: that is Chromium's (its old WebSQL
 * store), and Chromium deletes it when the app starts — which wiped every downloaded dataset on
 * the next launch.
 */
const DATASET_DIR_NAME = "puzzle-databases";
const CHROMIUM_OWNED_DIR_NAME = "databases";

export function datasetDir(userData: string): string {
  return join(userData, DATASET_DIR_NAME);
}

/** A dataset file (or partial download) of ours: named after its source. */
function isDatasetFile(name: string): boolean {
  return externalDatabaseSources.some((source) => name.startsWith(`${source.id}-`));
}

/**
 * Moves dataset files still in the old folder into the new one, before Chromium starts (and
 * clears the old folder). Must run before the app is ready. Returns the names moved.
 */
export function rescueLegacyDatasets(userData: string): string[] {
  const legacy = join(userData, CHROMIUM_OWNED_DIR_NAME);
  if (!existsSync(legacy)) return [];
  const target = datasetDir(userData);
  const moved: string[] = [];
  for (const name of readdirSync(legacy)) {
    if (!isDatasetFile(name) || !statSync(join(legacy, name)).isFile()) continue;
    mkdirSync(target, { recursive: true });
    if (existsSync(join(target, name))) continue;
    renameSync(join(legacy, name), join(target, name));
    moved.push(name);
  }
  return moved;
}

/** Where a file registered in the old folder is now, or null if it was registered elsewhere. */
export function relocatedDatasetPath(filePath: string, userData: string): string | null {
  if (dirname(filePath) !== join(userData, CHROMIUM_OWNED_DIR_NAME)) return null;
  return join(datasetDir(userData), basename(filePath));
}
