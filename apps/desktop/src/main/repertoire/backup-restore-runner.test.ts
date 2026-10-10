import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import type { RestoreJob } from "./backup-restore";
import { runBackupRestore } from "./backup-restore-runner";

const dir = mkdtempSync(join(tmpdir(), "chaturanga-backup-restore-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/**
 * A stand-in restore worker; the job's text picks its behaviour. It waits for the service's
 * `restore` message like the real one. "ok" replies with what it received; "fail" with a refusal;
 * "crash" opens a transaction on the real file, inserts a row and dies before committing.
 */
const FAKE_RESTORE = join(dir, "fake-restore.mjs");
writeFileSync(
  FAKE_RESTORE,
  `import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
const { dbPath, job } = workerData;
parentPort.once("message", (message) => {
  if (job.text === "ok") {
    parentPort.postMessage({
      ok: true,
      restored: [{ sourceId: job.selections[0].sourceId, repertoireId: "copy", mode: "new-copy",
        retainedBackupPath: null, revision: 1, message, job: { ...job, text: undefined } }]
    });
  }
  if (job.text === "fail") parentPort.postMessage({ ok: false, error: "Invalid selections: refused" });
  if (job.text === "crash") {
    const db = new DatabaseSync(dbPath);
    db.exec("BEGIN IMMEDIATE");
    db.exec("INSERT INTO rows (name) VALUES ('half-restored')");
    process.exit(3);
  }
});
`
);

function job(text: string): RestoreJob {
  return {
    text,
    selections: [{ sourceId: "r1", mode: "new-copy", includeProgress: false }],
    now: 5,
    retainedDirectory: join(dir, "retained"),
    app: { name: "Chaturanga", version: "1.2.3" }
  };
}

describe("runBackupRestore (restore worker)", () => {
  it("hands the job to the worker, starts it and resolves with what it restored", async () => {
    const restored = await runBackupRestore(job("ok"), () => join(dir, "ok.sqlite"), {
      workerPath: FAKE_RESTORE
    });
    expect(restored).toEqual([
      {
        sourceId: "r1",
        repertoireId: "copy",
        mode: "new-copy",
        retainedBackupPath: null,
        revision: 1,
        message: "restore",
        job: {
          selections: [{ sourceId: "r1", mode: "new-copy", includeProgress: false }],
          now: 5,
          retainedDirectory: join(dir, "retained"),
          app: { name: "Chaturanga", version: "1.2.3" }
        }
      }
    ]);
  });

  it("refuses to restore in this thread when the worker is required (packaged app)", async () => {
    const missing = join(dir, "missing-restore.js");
    await expect(
      runBackupRestore(job("ok"), () => "", { requireWorker: true, workerPath: missing })
    ).rejects.toThrow(
      `The backup restore can't run: a file of this installation is missing (${missing})`
    );
  });

  it("rejects with the worker's error", async () => {
    await expect(
      runBackupRestore(job("fail"), () => "", { workerPath: FAKE_RESTORE })
    ).rejects.toThrow("Invalid selections: refused");
  });

  it("a crash before commit leaves nothing restored and rejects with an actionable error", async () => {
    const dbPath = join(dir, "crash.sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("CREATE TABLE rows (name TEXT)");
    await expect(
      runBackupRestore(job("crash"), () => dbPath, { workerPath: FAKE_RESTORE })
    ).rejects.toThrow(
      "The backup couldn't be restored: the restore stopped unexpectedly (exit 3); nothing was restored. Try again."
    );
    expect(db.prepare("SELECT COUNT(*) AS n FROM rows").get()).toEqual({ n: 0 });
    // The dead connection's lock is gone: this connection can write.
    db.exec("INSERT INTO rows (name) VALUES ('after')");
    db.close();
  });
});
