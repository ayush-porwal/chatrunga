/**
 * What the database tests' module mocks stand on: userData, the registry's rows, whole-file scan
 * counting and a rename hook. Tests load it in `vi.hoisted` (their `vi.mock` factories use it), so
 * it imports no mocked module, and keeps one instance across `vi.resetModules`.
 */
import { mkdtempSync } from "node:fs";
import type * as FsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as PuzzleScan from "../puzzle-scan";

export const userData = mkdtempSync(join(tmpdir(), "chaturanga-databases-"));

type Row = {
  id: string;
  sourceId: string;
  filePath: string;
  fileSizeBytes?: number;
  name?: string;
  format?: string;
};
/** The registry's rows, by source id. */
export const rows = new Map<string, Row>();
export const repository = { failSave: false };

export const externalDatabaseRepository = {
  list: () => [...rows.values()],
  updateFilePath: (id: string, filePath: string) => {
    for (const row of rows.values()) if (row.id === id) row.filePath = filePath;
  },
  get: (id: string) => [...rows.values()].find((row) => row.id === id) ?? null,
  getBySource: (sourceId: string) => rows.get(sourceId) ?? null,
  remove: (id: string) => {
    for (const [key, row] of rows) if (row.id === id) rows.delete(key);
  },
  saveDownloaded: (input: { source: { id: string }; filePath: string; fileSizeBytes: number }) => {
    if (repository.failSave) throw new Error("disk full");
    const row = {
      id: input.source.id,
      sourceId: input.source.id,
      filePath: input.filePath,
      fileSizeBytes: input.fileSizeBytes
    };
    rows.set(input.source.id, row);
    return row;
  }
};

/** Counts the scans of the whole file (no match limit), and can make them fail like a corrupt file. */
export const fullScans = { count: 0, fail: false };

export function countingFullScans(actual: typeof PuzzleScan): typeof PuzzleScan {
  return {
    ...actual,
    reservoirScan: (job, isCancelled) => {
      if (job.maxMatches !== undefined) return actual.reservoirScan(job, isCancelled);
      fullScans.count += 1;
      return fullScans.fail
        ? Promise.reject(new Error("corrupt block"))
        : actual.reservoirScan(job, isCancelled);
    }
  };
}

/** Holds a download inside `finishDownload`, after its last cancellation check. */
export const fsHooks = { beforeRename: null as null | (() => Promise<void>) };

export function withRenameHook(actual: typeof FsPromises): typeof FsPromises {
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      await fsHooks.beforeRename?.();
      return actual.rename(...args);
    }
  };
}
