/**
 * Worker thread: stores one import commit (design §11) on its own WAL connection, so neither the
 * reindex planning nor the inserts run on the main thread. It receives the job through
 * `workerData`, the chapters as slices (import-writer-protocol.ts), and on `commit` runs
 * `commitImportJob` in one transaction, replying `{ ok, result }` or `{ ok: false, error }`. If the
 * worker dies mid-way the transaction never commits, so nothing is written.
 */
import { DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";
import { setRepertoireConnection } from "./connection";
import { commitImportJob, type ImportCommitChapter } from "./core";
import type {
  ImportWriterData,
  ImportWriterReply,
  ImportWriterRequest
} from "./import-writer-protocol";

const { dbPath, job } = workerData as ImportWriterData;
const chapters: ImportCommitChapter[] = [];
const reply = (message: ImportWriterReply) => parentPort?.postMessage(message);

function commit(): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");
    // A larger page cache shortens the transaction (the 100,000 index rows), so the write lock
    // other connections wait on is held for less time.
    db.exec("PRAGMA cache_size = -65536");
    setRepertoireConnection(() => db);
    reply({ ok: true, result: commitImportJob({ ...job, chapters }) });
  } catch (error) {
    reply({ ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    db.close();
  }
}

parentPort?.on("message", (request: ImportWriterRequest) => {
  if (request.type === "chapter") {
    chapters.push({ ...request.chapter, tree: [], positionKeys: {} });
  } else if (request.type === "nodes") {
    const current = chapters[chapters.length - 1];
    for (const node of request.nodes) current.tree.push(node);
    for (const [id, key] of request.keys) current.positionKeys[id] = key;
  } else {
    commit();
  }
});
