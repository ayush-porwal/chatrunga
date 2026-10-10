/**
 * Runs a backup restore in the bundled restore worker (backup-restore-worker.ts), so validation,
 * the retained copies and the restore transaction stay off the main thread. Without the bundled
 * worker (tests, development) the same restore runs in this thread; a packaged app requires it.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import {
  runRestoreJob,
  type BackupRestoreData,
  type BackupRestoreReply,
  type RestoredRepertoire,
  type RestoreJob
} from "./backup-restore";
import { missingWorkerError } from "./import-runner";

/** The worker bundled next to the main entry (electron.vite.config.ts). */
export const BACKUP_RESTORE_WORKER = join(
  dirname(fileURLToPath(import.meta.url)),
  "repertoire-backup-restore-worker.js"
);

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Restores `job` and resolves with what was restored once it is committed; rejects with the
 * restore's error (nothing restored), or an actionable error when the worker stops before
 * replying. With `requireWorker` (the packaged app), a missing worker file rejects with
 * missingWorkerError.
 */
export async function runBackupRestore(
  job: RestoreJob,
  dbPath: () => string,
  options: { requireWorker?: boolean; workerPath?: string } = {}
): Promise<RestoredRepertoire[]> {
  const { requireWorker = false, workerPath = BACKUP_RESTORE_WORKER } = options;
  if (!existsSync(workerPath)) {
    if (requireWorker) throw missingWorkerError(workerPath, "The backup restore");
    await yieldToEventLoop();
    return runRestoreJob(job);
  }

  const worker = new Worker(workerPath, {
    workerData: { dbPath: dbPath(), job } satisfies BackupRestoreData
  });
  try {
    const reply = new Promise<RestoredRepertoire[]>((resolve, reject) => {
      worker.once("message", (message: BackupRestoreReply) => {
        if (message.ok) resolve(message.restored);
        else reject(new Error(message.error));
      });
      worker.once("error", (error: Error) =>
        reject(
          new Error(`The backup couldn't be restored (${error.message}); nothing was restored.`)
        )
      );
      worker.once("exit", (code) =>
        reject(
          new Error(
            `The backup couldn't be restored: the restore stopped unexpectedly (exit ${code}); ` +
              "nothing was restored. Try again."
          )
        )
      );
    });
    worker.postMessage("restore");
    return await reply;
  } finally {
    void worker.terminate();
  }
}
