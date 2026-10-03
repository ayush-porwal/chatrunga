/**
 * Worker thread: restores a backup (backup-restore.ts `runRestoreJob`) on its own WAL connection,
 * so neither the validation, the retained copies nor the restore transaction run on the main
 * thread. It receives the job through `workerData`, starts on the service's `restore` message
 * (listening keeps it alive until the service terminates it, so the reply is never cut off) and
 * replies once, `{ ok, restored }` or `{ ok: false, error }`. If the worker dies mid-way the
 * transaction never commits, so nothing is restored.
 */
import { parentPort, workerData } from "node:worker_threads";
import { runRestoreJob, type BackupRestoreData, type BackupRestoreReply } from "./backup-restore";
import { withOwnConnection } from "./connection";

const { dbPath, job } = workerData as BackupRestoreData;
const reply = (message: BackupRestoreReply) => parentPort?.postMessage(message);

function restore(): void {
  try {
    reply({ ok: true, restored: withOwnConnection(dbPath, () => runRestoreJob(job)) });
  } catch (error) {
    reply({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

parentPort?.once("message", restore);
