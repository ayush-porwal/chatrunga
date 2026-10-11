/**
 * The puzzle databases on disk: which registered files are still there (following one moved from
 * the old folder), and undoing what an interrupted install of a new copy left behind.
 */
import { app } from "electron";
import { existsSync } from "node:fs";
import { readFile, rename, stat, unlink } from "node:fs/promises";
import type { InstalledDatabase } from "@chaturanga/shared/types/database";
import { externalDatabaseRepository } from "../db/external-database-repository";
import { errorCode } from "../system-error";
import { relocatedDatasetPath } from "./dataset-location";

export function isMissingFile(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

/**
 * The database with its file on disk: a file registered in the old folder that was moved (see
 * dataset-location.ts) gets its new path. Null when the file is gone (the entry is dropped).
 */
export async function onDisk(database: InstalledDatabase): Promise<InstalledDatabase | null> {
  // An install of a new copy that stopped before it was registered: the registered copy comes back
  // (the new one may be on disk in its place).
  const settled = existsSync(installMarkerFor(database.filePath))
    ? await settleBackup(database.filePath, database).then(
        () => true,
        () => false
      )
    : true;
  try {
    await stat(database.filePath);
    return database;
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  // Missing because an install was interrupted mid-swap: the installed file is still in its `.bak`.
  const restored =
    settled &&
    (await settleBackup(database.filePath, database).then(
      () => true,
      () => false
    ));
  if (existsSync(database.filePath)) return database;
  // An interrupted install couldn't be settled now (in use, no permission): keep the entry, so a
  // later listing tries again rather than forgetting a dataset that is still on disk.
  if (
    !restored &&
    (existsSync(backupPathFor(database.filePath)) ||
      existsSync(installMarkerFor(database.filePath)))
  ) {
    return null;
  }
  const moved = relocatedDatasetPath(database.filePath, app.getPath("userData"));
  if (moved && (await fileSize(moved)) > 0) {
    externalDatabaseRepository.updateFilePath(database.id, moved);
    return { ...database, filePath: moved };
  }
  externalDatabaseRepository.remove(database.id);
  return null;
}

/** Installed databases whose file is still on disk; rows for deleted files are dropped. */
export async function listInstalledDatabases(): Promise<InstalledDatabase[]> {
  const available: InstalledDatabase[] = [];
  for (const database of externalDatabaseRepository.list()) {
    const present = await onDisk(database);
    if (present) available.push(present);
  }
  return available;
}

export async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (isMissingFile(error)) return 0;
    throw error;
  }
}

/** Where an installed file waits while a new download replaces it. */
export function backupPathFor(filePath: string): string {
  return `${filePath}.bak`;
}

/** Present while a new copy of `filePath` is swapped in and not yet registered. */
export function installMarkerFor(filePath: string): string {
  return `${filePath}.installing`;
}

/**
 * Undoes what an interrupted install left (the app crashed or was killed mid-swap). Its marker
 * holds the new copy's size. If the registry (`registered`, the row for that source) already
 * describes the new copy, the install finished and only its leftovers go. Otherwise the new copy
 * was never registered: if it already took the file's place it goes back to `.part` (with its
 * `.validator`, so downloading again finishes at once), and the installed copy comes back from
 * `.bak`. Without a marker, a `.bak` is put back when the file is missing and is otherwise stale
 * (deleted). Run before each download of that file (downloads of one source never overlap) and by
 * `onDisk`.
 */
export async function settleBackup(
  filePath: string,
  registered: Pick<InstalledDatabase, "fileSizeBytes"> | null
): Promise<void> {
  const backupPath = backupPathFor(filePath);
  const markerPath = installMarkerFor(filePath);
  const partPath = `${filePath}.part`;
  const marked = existsSync(markerPath);
  const newSize = marked ? Number(await readFile(markerPath, "utf8")) : NaN;
  const committed =
    marked &&
    registered !== null &&
    registered.fileSizeBytes === newSize &&
    !existsSync(partPath) &&
    (await fileSize(filePath)) === newSize;
  const interrupted = marked && !committed;
  // Before the swap the new copy is the `.part`; after it, the `.part` is gone and the file is the new copy.
  if (interrupted && !existsSync(partPath) && existsSync(filePath))
    await rename(filePath, partPath);
  if (existsSync(backupPath)) {
    if (existsSync(filePath)) await unlink(backupPath).catch(() => undefined);
    else await rename(backupPath, filePath);
  }
  // A finished install's resume token for the `.part` it came from.
  if (committed) await unlink(`${partPath}.validator`).catch(() => undefined);
  if (marked) await unlink(markerPath);
}
