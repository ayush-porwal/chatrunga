/** Worker thread: one full-file puzzle scan (see `reservoirScan`), so the main process stays responsive. */
import { parentPort, workerData } from "node:worker_threads";
import { reservoirScan, type ScanJob } from "./puzzle-scan";

reservoirScan(workerData as ScanJob).then(
  (result) => parentPort?.postMessage({ ok: true, result }),
  (error: unknown) => parentPort?.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) })
);
