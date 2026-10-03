/**
 * Worker thread: one PGN import parse (see `runImport`), so a large file never blocks the main
 * process. The job arrives through `workerData`; progress, then one final message, go back to the
 * service (import-runner.ts). A `cancel` message stops the parse at the next game or input piece.
 * The result goes back in slices, a bounded batch at a time (each batch waits for the service's
 * `more`), so the main thread never has to take in a large burst of messages in one turn.
 */
import { parentPort, workerData } from "node:worker_threads";
import {
  ImportCancelledError,
  RESULT_BATCH_COST,
  resultMessages,
  runImport,
  type ImportedPgn,
  type ImportWorkerJob,
  type ImportWorkerMessage,
  type ImportWorkerRequest
} from "./import-job";

const job = workerData as ImportWorkerJob;
let cancelled = false;
let resume: (() => void) | null = null;
const post = (message: ImportWorkerMessage) => parentPort?.postMessage(message);

parentPort?.on("message", (request: ImportWorkerRequest) => {
  if (request?.type === "cancel") cancelled = true;
  if (request?.type === "more") {
    resume?.();
    resume = null;
  }
});

/** Sends the result in batches of RESULT_BATCH_COST, waiting for `more` after each batch. */
async function sendResult(result: ImportedPgn): Promise<void> {
  let cost = 0;
  for (const message of resultMessages(result)) {
    post(message);
    cost += message.type === "nodes" ? message.nodes.length : 50;
    if (cost >= RESULT_BATCH_COST && message.type !== "done") {
      cost = 0;
      await new Promise<void>((resolve) => {
        resume = resolve;
        post({ type: "wait" });
      });
    }
  }
}

runImport(job.source, job.limits, {
  onProgress: (progress) => post({ type: "progress", progress }),
  isCancelled: () => cancelled
}).then(
  (result) => sendResult(result),
  (error: unknown) =>
    post(
      error instanceof ImportCancelledError
        ? { type: "cancelled" }
        : { type: "failed", message: error instanceof Error ? error.message : String(error) }
    )
);
