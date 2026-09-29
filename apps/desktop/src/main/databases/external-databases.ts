import { app } from "electron";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import {
  externalDatabaseSources,
  type DatabaseDownloadProgress,
  type InstalledDatabase,
  type PuzzleSample,
  type PuzzleSampleInput
} from "@chaturanga/shared/types/database";
import { externalDatabaseRepository } from "../db/repositories";
import { errorMessage } from "../logger";
import { datasetDir, relocatedDatasetPath } from "./dataset-location";
import { sampleFromLichessRow, sampleFromPositionRow, type PuzzleRowKind } from "./puzzle-rows";
import { reservoirScan, type ScanJob, type ScanResult } from "./puzzle-scan";

const PROGRESS_INTERVAL_MS = 120;
/** A download with no data for this long is abandoned (its `.part` file stays for a resume). */
const STALL_TIMEOUT_MS = 60_000;
/** The quick answer for new filters: a random pick among the first matches in the file. */
const QUICK_MATCHES = 500;
/** Puzzles kept per filter set from a scan of the whole file; refilled in the background. */
const POOL_SIZE = 64;
const POOL_REFILL_BELOW = 8;
const MAX_POOLS = 6;

type ProgressSink = (progress: DatabaseDownloadProgress) => void;

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

/**
 * The database with its file on disk: a file registered in the old folder that was moved (see
 * dataset-location.ts) gets its new path. Null when the file is gone (the entry is dropped).
 */
async function onDisk(database: InstalledDatabase): Promise<InstalledDatabase | null> {
  try {
    await stat(database.filePath);
    return database;
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  const moved = relocatedDatasetPath(database.filePath, app.getPath("userData"));
  if (moved && (await fileSize(moved)) > 0) {
    externalDatabaseRepository.updateFilePath(database.id, moved);
    return { ...database, filePath: moved };
  }
  externalDatabaseRepository.remove(database.id);
  return null;
}

/** Installed databases whose file is still on disk; rows for deleted files are dropped. */
export async function listInstalledDatabases(): Promise<InstalledDatabase[]> {
  const available: InstalledDatabase[] = [];
  for (const database of externalDatabaseRepository.list()) {
    const present = await onDisk(database);
    if (present) available.push(present);
  }
  return available;
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (isMissingFile(error)) return 0;
    throw error;
  }
}

/** Downloads in flight, per source: a second request for the same database joins the first. */
const inFlight = new Map<string, { promise: Promise<InstalledDatabase>; controller: AbortController }>();
/** The latest progress of each running download, for a page opened while it runs. */
const latestProgress = new Map<string, DatabaseDownloadProgress>();

/** Running downloads (their latest progress), e.g. for the Databases page when it opens. */
export function activeDownloads(): DatabaseDownloadProgress[] {
  return [...latestProgress.values()];
}

/** Stops a running download; its `.part` file stays, so downloading again resumes it. */
export function cancelDownload(sourceId: string): void {
  inFlight.get(sourceId)?.controller.abort(new DownloadCancelledError());
}

class DownloadCancelledError extends Error {
  constructor() {
    super("Download cancelled.");
  }
}

/**
 * Streams a catalogued source into `userData/puzzle-databases` (see dataset-location.ts), reporting progress. The data goes to a
 * `.part` file that is renamed into place only once complete, and a download cut short (the app
 * quit, e.g. to install an update, or the network dropped) resumes from where it stopped — but only
 * a partial whose server version (ETag / Last-Modified) was recorded, so two versions never mix.
 */
export function downloadDatabase(sourceId: string, onProgress: ProgressSink): Promise<InstalledDatabase> {
  const running = inFlight.get(sourceId);
  if (running) return running.promise;
  const controller = new AbortController();
  const report: ProgressSink = (progress) => {
    if (progress.state === "downloading") latestProgress.set(progress.sourceId, progress);
    else latestProgress.delete(progress.sourceId);
    onProgress(progress);
  };
  const promise = runDownload(sourceId, report, controller.signal).finally(() => {
    inFlight.delete(sourceId);
    latestProgress.delete(sourceId);
  });
  inFlight.set(sourceId, { promise, controller });
  return promise;
}

/** Byte offsets must address the file as stored, so no transfer encoding (gzip) may apply. */
const IDENTITY = { "Accept-Encoding": "identity" };

/** The server's file didn't match the partial download: start that source over. */
const RESTART = Symbol("restart");

async function runDownload(sourceId: string, onProgress: ProgressSink, signal: AbortSignal): Promise<InstalledDatabase> {
  const source = externalDatabaseSources.find((item) => item.id === sourceId);
  if (!source) throw new Error("Database source not found");
  const dir = datasetDir(app.getPath("userData"));
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${source.id}-${basename(new URL(source.url).pathname)}`);
  const partPath = `${filePath}.part`;
  // The server's ETag / Last-Modified for the `.part` file: a resume only continues the same file.
  const validatorPath = `${partPath}.validator`;

  // Aborted by Cancel, or when no data arrives for a while (a dead connection would otherwise
  // hold this download — and every retry that joins it — forever).
  const stall = new AbortController();
  const stalled = () => stall.abort(new Error("The download stalled. Try again to resume it."));
  let stallTimer = setTimeout(stalled, STALL_TIMEOUT_MS);
  const touch = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(stalled, STALL_TIMEOUT_MS);
  };
  const aborted = AbortSignal.any([signal, stall.signal]);

  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await downloadOnce();
      if (result !== RESTART) return result;
      await unlink(partPath).catch(() => undefined);
      await unlink(validatorPath).catch(() => undefined);
    }
    throw new Error("The download couldn't be resumed. Try again later.");
  } catch (error) {
    const reason = aborted.aborted ? aborted.reason : error;
    onProgress({
      sourceId: source.id,
      downloadedBytes: 0,
      totalBytes: null,
      percent: null,
      state: reason instanceof DownloadCancelledError ? "cancelled" : "failed",
      message: errorMessage(reason)
    });
    throw reason;
  } finally {
    clearTimeout(stallTimer);
  }

  async function downloadOnce(): Promise<InstalledDatabase | typeof RESTART> {
    const current = source!;
    const validator = (await readFile(validatorPath, "utf8").catch(() => "")).trim();
    if (!validator) {
      // A partial with no recorded version can't be continued safely: start over.
      await unlink(partPath).catch(() => undefined);
    }
    const offset = validator ? await fileSize(partPath) : 0;
    // If-Range: the server sends the rest only if the file is unchanged, otherwise all of it (200).
    const response = await fetch(
      current.url,
      offset
        ? { headers: { ...IDENTITY, Range: `bytes=${offset}-`, "If-Range": validator }, signal: aborted }
        : { headers: IDENTITY, signal: aborted }
    );
    touch();
    if (response.status === 416 && offset) {
      await response.body?.cancel();
      // Same version, nothing past `offset`: complete only if it is exactly the file's length.
      if (rangeTotal(response.headers.get("content-range")) === offset) {
        return finishDownload(current, partPath, filePath, onProgress, null);
      }
      return RESTART;
    }
    if (!response.ok || !response.body) {
      throw new Error(`Download failed (${response.status} ${response.statusText})`);
    }
    // A 206 must continue exactly where the partial file ends, or the bytes would be misplaced.
    if (response.status === 206 && rangeStart(response.headers.get("content-range")) !== offset) {
      await response.body.cancel();
      return RESTART;
    }
    // 206: the server continues after `offset`; 200: a new version, or no range asked: start over.
    const resumed = response.status === 206;
    const startBytes = resumed ? offset : 0;
    if (!resumed) {
      const nextValidator = response.headers.get("etag") ?? response.headers.get("last-modified");
      if (nextValidator) await writeFile(validatorPath, nextValidator);
      else await unlink(validatorPath).catch(() => undefined);
    }
    const remainingBytes = parseContentLength(response.headers.get("content-length"));
    const totalBytes = remainingBytes === null ? null : startBytes + remainingBytes;
    let downloadedBytes = startBytes;
    let lastEmitAt = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        touch();
        downloadedBytes += chunk.byteLength;
        const now = Date.now();
        if (now - lastEmitAt >= PROGRESS_INTERVAL_MS) {
          lastEmitAt = now;
          onProgress({
            sourceId: current.id,
            downloadedBytes,
            totalBytes,
            percent: totalBytes ? Math.min(99, Math.round((downloadedBytes / totalBytes) * 100)) : null,
            state: "downloading"
          });
        }
        callback(null, chunk);
      }
    });

    // On failure the `.part` file stays, so the next attempt resumes instead of starting over.
    await pipeline(
      Readable.fromWeb(response.body as never),
      meter,
      createWriteStream(partPath, { flags: resumed ? "a" : "w" }),
      { signal: aborted }
    );
    if (totalBytes !== null && downloadedBytes !== totalBytes) {
      throw new Error("The download ended early. Try again to resume it.");
    }
    return finishDownload(current, partPath, filePath, onProgress, totalBytes);
  }
}

async function finishDownload(
  source: (typeof externalDatabaseSources)[number],
  partPath: string,
  filePath: string,
  onProgress: ProgressSink,
  totalBytes: number | null
): Promise<InstalledDatabase> {
  await rename(partPath, filePath);
  await unlink(`${partPath}.validator`).catch(() => undefined);
  const file = await stat(filePath);
  // Registered first: "completed" is only announced for a database Puzzles can use.
  const installed = externalDatabaseRepository.saveDownloaded({
    source,
    filePath,
    fileSizeBytes: file.size,
    recordCount: source.expectedRecords ?? null
  });
  dropPools(installed.id);
  onProgress({
    sourceId: source.id,
    downloadedBytes: file.size,
    totalBytes: totalBytes ?? file.size,
    percent: 100,
    state: "completed"
  });
  return installed;
}

/**
 * Deletes the file (and any partial download) first, then the entry: a file that can't be deleted
 * (in use, no permission) keeps its entry, so it isn't left behind unlisted, and Delete can be retried.
 */
export async function removeDatabase(id: string): Promise<void> {
  const database = externalDatabaseRepository.get(id);
  if (!database) return;
  for (const path of [database.filePath, `${database.filePath}.part`, `${database.filePath}.part.validator`]) {
    await unlink(path).catch((error: unknown) => {
      if (!isMissingFile(error)) throw error;
    });
  }
  externalDatabaseRepository.remove(database.id);
  dropPools(database.id);
}

type SamplePool = {
  /** Candidate rows, a uniform sample of every match in the file. */
  rows: string[][];
  /** The scan found no more matches than it kept: `rows` is every match. */
  complete: boolean;
  filling: Promise<void> | null;
};

/** Per database + filters. A small pool, filled from one scan of the whole file, serves many puzzles. */
const pools = new Map<string, SamplePool>();

function poolKey(input: PuzzleSampleInput): string {
  return JSON.stringify([input.databaseId, input.lichess ?? null, input.position ?? null]);
}

function dropPools(databaseId: string): void {
  for (const key of pools.keys()) if (JSON.parse(key)[0] === databaseId) pools.delete(key);
}

/**
 * A random puzzle matching the filters, drawn from the whole file. The first request for a set of
 * filters answers from a quick scan of the file's start while a background scan of the whole file
 * (in a worker thread) fills a pool; later requests take from the pool, so the file isn't
 * decompressed again for every puzzle, and puzzles near the end are as likely as the first ones.
 */
export async function samplePuzzle(input: PuzzleSampleInput): Promise<PuzzleSample> {
  const registered = externalDatabaseRepository.get(input.databaseId);
  if (!registered) throw new Error("Puzzle database not found. Download a database first.");
  const database = await onDisk(registered);
  if (!database) {
    dropPools(registered.id);
    throw new Error(`${registered.name} is missing from disk. Download the database again.`);
  }

  const kind: PuzzleRowKind = database.sourceId === "lichess-puzzles" ? "lichess" : "position";
  const excluded = new Set(input.excludeIds ?? []);
  const key = poolKey(input);
  let pool = pools.get(key);
  if (!pool) {
    pool = { rows: [], complete: false, filling: null };
    pools.set(key, pool);
    // Oldest filter sets go first.
    for (const oldKey of pools.keys()) {
      if (pools.size <= MAX_POOLS) break;
      pools.delete(oldKey);
    }
  }
  const job: ScanJob = {
    filePath: database.filePath,
    compressed: database.format.endsWith(".zst"),
    kind,
    input,
    excludeIds: [...excluded],
    size: POOL_SIZE
  };
  const build = (row: string[]) => {
    try {
      const sample = (kind === "lichess" ? sampleFromLichessRow : sampleFromPositionRow)(database, row, input);
      return sample && !excluded.has(sample.id) ? sample : null;
    } catch {
      return null; // Malformed row (e.g. an illegal FEN): skip it.
    }
  };

  let sample = takeFromPool(pool, build);
  if (!sample && pool.complete) {
    // Every match is known; wait for a refill only if one is running (it may find unseen ones).
    if (pool.filling) await pool.filling;
    sample = takeFromPool(pool, build);
  }
  if (!sample && !pool.complete) {
    const quick = await reservoirScan({ ...job, size: 1, maxMatches: QUICK_MATCHES });
    sample = quick.rows.map(build).find(Boolean) ?? null;
  }
  if (pool.rows.length < POOL_REFILL_BELOW && !pool.filling && !(pool.complete && !pool.rows.length)) {
    const target = pool;
    target.filling = scanInWorker(job)
      .then((result) => {
        if (pools.get(key) !== target) return;
        target.rows = result.rows;
        target.complete = result.complete && result.matches <= POOL_SIZE;
      })
      .catch(() => undefined)
      .finally(() => {
        target.filling = null;
      });
  }
  if (!sample) throw new Error("No puzzle matched those filters. Try fewer themes or a wider rating range.");
  return sample;
}

/** Takes random rows out of the pool until one makes a puzzle (excluded or broken rows are dropped). */
function takeFromPool(pool: SamplePool, build: (row: string[]) => PuzzleSample | null): PuzzleSample | null {
  while (pool.rows.length) {
    const index = Math.floor(Math.random() * pool.rows.length);
    const [row] = pool.rows.splice(index, 1);
    const sample = row ? build(row) : null;
    if (sample) return sample;
  }
  return null;
}

/** The worker bundled next to the main entry; tests (and a missing file) scan in this thread. */
const SCAN_WORKER = join(dirname(fileURLToPath(import.meta.url)), "puzzle-scan-worker.js");

function scanInWorker(job: ScanJob): Promise<ScanResult> {
  if (!existsSync(SCAN_WORKER)) return reservoirScan(job);
  return new Promise((resolve, reject) => {
    const worker = new Worker(SCAN_WORKER, { workerData: job });
    worker.once("message", (message: { ok: true; result: ScanResult } | { ok: false; message: string }) => {
      if (message.ok) resolve(message.result);
      else reject(new Error(message.message));
      void worker.terminate();
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`Puzzle scan stopped (exit ${code}).`));
    });
  });
}

/** The full length a 416 reports (`Content-Range: bytes` + `*` + `/N`); null when absent or malformed. */
function rangeTotal(value: string | null): number | null {
  const match = /^bytes \*\/(\d+)$/.exec(value?.trim() ?? "");
  return match ? Number(match[1]) : null;
}

/** Where a 206 continues (`Content-Range: bytes START-END/TOTAL`); null when absent or malformed. */
function rangeStart(value: string | null): number | null {
  const match = /^bytes (\d+)-\d+\/(\d+|\*)$/.exec(value?.trim() ?? "");
  return match ? Number(match[1]) : null;
}

function parseContentLength(value: string | null): number | null {
  const parsed = Number(value);
  return value && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
