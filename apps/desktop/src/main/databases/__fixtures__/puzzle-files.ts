/** Paths, scanners and the per-test reset the database tests share (see database-fakes.ts). */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { reservoirScan, type PuzzleScanner, type ScanJob } from "../puzzle-scan";
import { fsHooks, fullScans, repository, rows, userData } from "./database-fakes";

export const SOURCE = "lichess-puzzles";
export const dir = join(userData, "puzzle-databases");
export const finalPath = join(dir, "lichess-puzzles-lichess_db_puzzle.csv.zst");
export const dailyRecord = join(userData, "puzzle-of-the-day.json");
export const LICHESS_HEADER =
  "PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags";

/** Scans in this thread (the worker can't load TypeScript sources), stopping when cancelled. */
export const inThreadScanner: PuzzleScanner = (job) => {
  let cancelled = false;
  return { result: reservoirScan(job, () => cancelled), cancel: () => void (cancelled = true) };
};

type GatedScan = { job: ScanJob; cancelled: boolean; release: () => void };
/** Gated scans: each waits for `release()` (unless `open(job)`), so tests can hold scans in flight. */
export const gatedScans: GatedScan[] = [];
export function gatedScanner(open: (job: ScanJob) => boolean = () => false): PuzzleScanner {
  return (job) => {
    const scan: GatedScan = { job, cancelled: false, release: () => undefined };
    const gate = new Promise<void>((resolve) => (scan.release = resolve));
    gatedScans.push(scan);
    if (open(job)) scan.release();
    return {
      result: gate.then(() => reservoirScan(job, () => scan.cancelled)),
      cancel: () => {
        scan.cancelled = true;
        scan.release();
      }
    };
  };
}
export const isQuick = (scan: GatedScan) => scan.job.maxMatches !== undefined;

/** No rows, no files, no hooks: the state every test starts from. */
export async function resetDatabaseFakes(): Promise<void> {
  rows.clear();
  repository.failSave = false;
  fullScans.count = 0;
  fullScans.fail = false;
  fsHooks.beforeRename = null;
  await rm(dir, { recursive: true, force: true });
  await rm(dailyRecord, { force: true });
}

export function releaseGatedScans(): void {
  for (const scan of gatedScans.splice(0)) scan.release();
}
