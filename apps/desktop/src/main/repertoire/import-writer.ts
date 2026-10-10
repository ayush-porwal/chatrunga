/**
 * Runs an import commit in the bundled writer worker (import-writer-worker.ts), sending the
 * chapters in bounded slices with a yield to the event loop between them. Without the bundled
 * worker (tests, development) the same commit runs in this thread; a packaged app requires it.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { ImportResult } from "@chaturanga/shared/types/repertoire";
import { commitImportJob, type ImportCommitJob } from "./core";
import { missingWorkerError } from "./import-runner";
import {
  WRITER_SLICE_NODES,
  type ImportWriterData,
  type ImportWriterReply,
  type ImportWriterRequest
} from "./import-writer-protocol";

/** The worker bundled next to the main entry (electron.vite.config.ts). */
export const IMPORT_WRITER_WORKER = join(
  dirname(fileURLToPath(import.meta.url)),
  "repertoire-import-writer-worker.js"
);

/** Longest stretch of posting slices before yielding to the event loop. */
const POST_SLICE_MS = 8;

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Commits `job` and resolves with the result once it is stored; rejects with the commit's error
 * (nothing written), or an actionable error when the worker stops before replying. With
 * `requireWorker` (the packaged app), a missing worker file rejects with missingWorkerError.
 */
export async function runImportCommit(
  job: ImportCommitJob,
  dbPath: () => string,
  options: { requireWorker?: boolean; workerPath?: string } = {}
): Promise<ImportResult> {
  const { requireWorker = false, workerPath = IMPORT_WRITER_WORKER } = options;
  if (!existsSync(workerPath)) {
    if (requireWorker) throw missingWorkerError(workerPath);
    await yieldToEventLoop();
    return commitImportJob(job);
  }

  const { chapters, ...header } = job;
  const worker = new Worker(workerPath, {
    workerData: { dbPath: dbPath(), job: header } satisfies ImportWriterData
  });
  const reply = new Promise<ImportResult>((resolve, reject) => {
    worker.once("message", (message: ImportWriterReply) => {
      if (message.ok) resolve(message.result);
      else reject(new Error(message.error));
    });
    worker.once("error", (error: Error) =>
      reject(new Error(`The import couldn't be saved (${error.message}); nothing was imported.`))
    );
    worker.once("exit", (code) =>
      reject(
        new Error(
          `The import couldn't be saved: the writer stopped unexpectedly (exit ${code}); ` +
            "nothing was imported. Try again."
        )
      )
    );
  });
  // A failure while sending (the worker died) still settles through `reply`.
  reply.catch(() => {});
  try {
    const post = (request: ImportWriterRequest) => worker.postMessage(request);
    let sliceStart = performance.now();
    for (const { tree, positionKeys, ...chapter } of chapters) {
      post({ type: "chapter", chapter });
      for (let start = 0; start < tree.length; start += WRITER_SLICE_NODES) {
        const nodes = tree.slice(start, start + WRITER_SLICE_NODES);
        const keys: [string, string][] = [];
        for (const node of nodes) {
          const key = positionKeys[node.id];
          if (key) keys.push([node.id, key]);
        }
        post({ type: "nodes", nodes, keys });
        if (performance.now() - sliceStart >= POST_SLICE_MS) {
          await yieldToEventLoop();
          sliceStart = performance.now();
        }
      }
    }
    post({ type: "commit" });
    return await reply;
  } finally {
    void worker.terminate();
  }
}
