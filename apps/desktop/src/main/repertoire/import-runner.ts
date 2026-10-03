/**
 * Starts an import parse in the bundled worker thread (import-worker.ts) and hands back its result
 * and a cancel function. Without the bundled worker (tests, development) the same parse runs in
 * this thread, yielding to the event loop between pieces of input; a packaged app requires the
 * worker instead (see missingWorkerError).
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import {
  ImportCancelledError,
  runImport,
  type ImportedPgn,
  type ImportProgress,
  type ImportWorkerJob,
  type ImportWorkerMessage,
  type ImportWorkerRequest
} from "./import-job";

/** The worker bundled next to the main entry (electron.vite.config.ts). */
export const IMPORT_WORKER = join(
  dirname(fileURLToPath(import.meta.url)),
  "repertoire-import-worker.js"
);

/** How long a cancelled worker may take to stop by itself before it is terminated. */
const CANCEL_GRACE_MS = 200;

export type ImportRun = {
  /** The parsed games; rejects with the limit error, or `ImportCancelledError` once cancelled. */
  result: Promise<ImportedPgn>;
  /** Stops the parse: the result rejects at once and no progress follows. */
  cancel(): void;
};

/**
 * The error for a bundled worker file that isn't there. A packaged app passes `requireWorker`, so
 * a broken installation fails loudly instead of parsing or writing on the main thread.
 */
export function missingWorkerError(workerPath: string): Error {
  return new Error(
    `The PGN import can't run: a file of this installation is missing (${workerPath}). ` +
      "Reinstall Chaturanga and try again."
  );
}

/**
 * Runs `job`, reporting its progress (never after it settled or was cancelled). With
 * `requireWorker` (the packaged app), a missing worker file rejects with missingWorkerError
 * instead of parsing in this thread.
 */
export function startImportParse(
  job: ImportWorkerJob,
  onProgress: (progress: ImportProgress) => void,
  workerPath: string = IMPORT_WORKER,
  requireWorker = false
): ImportRun {
  let settled = false;
  let settle!: (outcome: { result: ImportedPgn } | { error: unknown }) => void;
  const result = new Promise<ImportedPgn>((resolve, reject) => {
    settle = (outcome) => {
      if (settled) return;
      settled = true;
      if ("result" in outcome) resolve(outcome.result);
      else reject(outcome.error);
    };
  });
  const progress = (value: ImportProgress) => {
    if (!settled) onProgress(value);
  };

  if (!existsSync(workerPath) && requireWorker) {
    settle({ error: missingWorkerError(workerPath) });
    return { result, cancel: () => undefined };
  }
  if (!existsSync(workerPath)) {
    let cancelled = false;
    runImport(job.source, job.limits, { onProgress: progress, isCancelled: () => cancelled }).then(
      (parsed) => settle({ result: parsed }),
      (error: unknown) => settle({ error })
    );
    return {
      result,
      cancel: () => {
        cancelled = true;
        settle({ error: new ImportCancelledError() });
      }
    };
  }

  const worker = new Worker(workerPath, { workerData: job });
  let cancelled = false;
  const stop = () => void worker.terminate();
  const games: ImportedPgn["games"] = [];
  worker.on("message", (message: ImportWorkerMessage) => {
    if (message.type === "progress") return progress(message.progress);
    if (message.type === "game") {
      games.push({ ...message.game, tree: [], positionKeys: {} });
      return;
    }
    if (message.type === "nodes") {
      const game = games[games.length - 1];
      for (const node of message.nodes) game.tree.push(node);
      for (const [id, key] of message.keys) game.positionKeys[id] = key;
      return;
    }
    if (message.type === "wait") {
      // The next batch comes once this turn is over.
      setImmediate(() => {
        if (!settled) worker.postMessage({ type: "more" } satisfies ImportWorkerRequest);
      });
      return;
    }
    if (message.type === "done") settle({ result: { games } });
    else if (message.type === "failed") settle({ error: new Error(message.message) });
    else settle({ error: new ImportCancelledError() });
    stop();
  });
  worker.once("error", (error) =>
    settle({ error: cancelled ? new ImportCancelledError() : error })
  );
  worker.once("exit", (code) =>
    settle({
      error: cancelled
        ? new ImportCancelledError()
        : new Error(`The PGN import stopped unexpectedly (exit ${code}); try again.`)
    })
  );
  return {
    result,
    cancel: () => {
      if (settled) return;
      cancelled = true;
      settle({ error: new ImportCancelledError() });
      worker.postMessage({ type: "cancel" } satisfies ImportWorkerRequest);
      // The worker stops at its next game; a long game doesn't keep it running.
      setTimeout(stop, CANCEL_GRACE_MS).unref();
    }
  };
}
