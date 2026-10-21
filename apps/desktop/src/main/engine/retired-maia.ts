/**
 * Maia 1's retirement (Maia 3 replaced its five Lc0 weight files, `maia-1100` … `maia-1900`): the
 * asset manager forgets their records and deletes the files it downloaded for them, never a file
 * the user chose as their own. Loaded on demand by asset-manager.ts, so it stays out of the main
 * bundle.
 */
import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { logger } from "../logger";
import { errorCode } from "../system-error";

/** Maia 1's asset ids: their weights were `<id>.pb.gz` in the engines folder. */
const RETIRED_MAIA_IDS: readonly string[] = [1100, 1300, 1500, 1700, 1900].map(
  (rating) => `maia-${rating}`
);

/** A state-file record that isn't one of today's assets (only the fields read here). */
export type StoredRetiredRecord = { id: string; state?: unknown; customPath?: unknown };

/** The files removeRetiredMaia deletes by name: Maia 1's weights and its licence copy. */
function retiredFiles(enginesDir: string): string[] {
  return [
    ...RETIRED_MAIA_IDS.map((id) => path.resolve(enginesDir, `${id}.pb.gz`)),
    path.resolve(enginesDir, "LICENSE_MAIA.txt")
  ];
}

/** The user's own file a record points at; null when the record isn't custom. */
function customPathOf(record: StoredRetiredRecord): string | null {
  return record.state === "custom" && typeof record.customPath === "string" && record.customPath
    ? path.resolve(record.customPath)
    : null;
}

/**
 * Sorts the state file's records that aren't today's assets. Maia 1's are forgotten (`forgot`),
 * except one marked custom at a name removeRetiredMaia deletes: that file is the user's, so its
 * record is kept (`kept`, written back with the state) and no launch deletes it. Anything else is
 * dropped quietly.
 */
export function sortRetiredRecords(
  records: readonly StoredRetiredRecord[],
  enginesDir: string
): { kept: StoredRetiredRecord[]; forgot: boolean } {
  const names = new Set(retiredFiles(enginesDir));
  const kept: StoredRetiredRecord[] = [];
  let forgot = false;
  for (const record of records) {
    if (!RETIRED_MAIA_IDS.includes(String(record.id))) continue;
    const own = customPathOf(record);
    if (own && names.has(own)) kept.push(record);
    else forgot = true;
  }
  return { kept, forgot };
}

/**
 * Deletes Maia 1's weights, their partial downloads and the licence copy the asset manager put in
 * the engines folder, never a file a `kept` record marks as the user's (see sortRetiredRecords).
 * Idempotent; a file that can't go is logged.
 */
export async function removeRetiredMaia(
  enginesDir: string,
  kept: readonly StoredRetiredRecord[]
): Promise<void> {
  const downloadsDir = path.join(enginesDir, ".downloads");
  const partials = (await readdir(downloadsDir).catch(() => [] as string[]))
    .filter((name) => RETIRED_MAIA_IDS.some((id) => name.startsWith(`${id}--`)))
    .map((name) => path.resolve(downloadsDir, name));
  const usersOwn = new Set(kept.map(customPathOf));
  const files = [...retiredFiles(enginesDir), ...partials].filter((file) => !usersOwn.has(file));
  await Promise.all(
    files.map((file) =>
      unlink(file).catch((error: unknown) => {
        if (errorCode(error) !== "ENOENT")
          logger.warn(
            "asset-manager",
            `could not delete ${file}:`,
            error instanceof Error ? error.message : String(error)
          );
      })
    )
  );
}
