/** Worker thread: one full-file puzzle scan (see `reservoirScan`), so the main process stays responsive. */
import { parentPort, workerData } from "node:worker_threads";
import { reservoirScan, type ScanJob } from "./puzzle-scan";

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the runner starts this worker with a ScanJob
reservoirScan(workerData as ScanJob).then(
  (result) => parentPort?.postMessage({ ok: true, result }),
  (error: unknown) => parentPort?.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) })
);
