/**
 * What the backup tests' module mocks stand on: userData (with a folder for written files), the
 * windows' sent events, the save and open dialogs, and restores run in this thread. Tests load it
 * in `vi.hoisted` (their `vi.mock` factories use it), so it imports no mocked module.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import type * as BackupRestoreRunner from "../backup-restore-runner";

export const userData = mkdtempSync(join(tmpdir(), "chaturanga-backup-test-"));
/** Where tests write backup files. */
export const files = join(userData, "files");
export const sent: { channel: string; payload: unknown }[] = [];
export const showSaveDialog = vi.fn(async (...args: unknown[]) => {
  void args;
  return { canceled: true, filePath: undefined as string | undefined };
});
export const showOpenDialog = vi.fn(async (...args: unknown[]) => {
  void args;
  return { canceled: true, filePaths: [] as string[] };
});

export const electronModule = {
  app: {
    isPackaged: true,
    getPath: () => userData,
    getName: () => "Chaturanga",
    getVersion: () => "9.9.9"
  },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send: (channel: string, payload: unknown) => sent.push({ channel, payload })
        }
      }
    ],
    getFocusedWindow: () => null
  },
  dialog: {
    showSaveDialog: (...args: unknown[]) => showSaveDialog(...args),
    showOpenDialog: (...args: unknown[]) => showOpenDialog(...args)
  }
};

/**
 * The app mock reports a packaged build (for the backup's app version), which requires the
 * bundled restore worker; tests have none, so restores run in this thread as in development.
 */
export function inThreadRestores(actual: typeof BackupRestoreRunner): typeof BackupRestoreRunner {
  return {
    ...actual,
    runBackupRestore: (...[job, dbPath, options]: Parameters<typeof actual.runBackupRestore>) =>
      actual.runBackupRestore(job, dbPath, { ...options, requireWorker: false })
  };
}
