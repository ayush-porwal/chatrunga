import { app } from "electron";
import { constants, createWriteStream, existsSync } from "node:fs";
import { copyFile, link, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import {
  externalDatabaseSources,
  type DatabaseDownloadProgress,
  type InstalledDatabase,
  type PuzzleSample,
  type PuzzleSampleInput
} from "@chaturanga/shared/types/database";
import { externalDatabaseRepository } from "../db/repositories";
import { errorMessage, logger } from "../logger";
import { datasetDir, relocatedDatasetPath } from "./dataset-location";
import { InvalidDatasetError, isHtmlContentType, validateDataset } from "./dataset-validation";
import { rowKindForSource, sampleFromLichessRow, sampleFromPositionRow, type PuzzleRowKind } from "./puzzle-rows";
import {
  ScanCancelledError,
  ScanWorkerError,
  workerScanner,
  type PuzzleScanner,
  type RunningScan,
  type ScanJob,
  type ScanResult
} from "./puzzle-scan";

const PROGRESS_INTERVAL_MS = 120;
/** A download with no data for this long is abandoned (its `.part` file stays for a resume). */
const STALL_TIMEOUT_MS = 60_000;
/** How long quitting waits for cancelled downloads to close their files. */
const CANCEL_TIMEOUT_MS = 3_000;
/** The quick answer for new filters: a random sample of the first matches in the file. */
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
  // Missing because an install was interrupted mid-swap: the installed file is still in its `.bak`.
  const restored = await settleBackup(database.filePath).then(
    () => true,
    () => false
  );
  if (existsSync(database.filePath)) return database;
  // The backup couldn't be put back now (in use, no permission): keep the entry, so a later
  // listing tries again rather than forgetting a dataset that is still on disk.
  if (!restored && existsSync(backupPathFor(database.filePath))) return null;
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
/** Removals in progress, per source: a download of that source starts only once its removal is done. */
const removals = new Map<string, Promise<void>>();
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

/** Set once quitting starts: the database is about to close, so no download may register any more. */
let shuttingDown = false;

/**
 * Quitting: running downloads stop (their partial files stay, so the next attempt resumes).
 * Resolves once they have settled, or after `timeoutMs`, so a stuck one can't hold up the quit;
 * one that finishes later still installs nothing (see `finishDownload`).
 */
export async function cancelAllDownloads(timeoutMs = CANCEL_TIMEOUT_MS): Promise<void> {
  shuttingDown = true;
  const running = [...inFlight.values()];
  for (const sourceId of inFlight.keys()) cancelDownload(sourceId);
  if (!running.length) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled(running.map((download) => download.promise)),
    new Promise((resolve) => (timer = setTimeout(resolve, timeoutMs)))
  ]);
  clearTimeout(timer);
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
  const run = () => runDownload(sourceId, report, controller.signal);
  const removal = removals.get(sourceId);
  // After a removal of the same database, which would otherwise delete the new files.
  const promise = (removal ? removal.catch(() => undefined).then(run) : run()).finally(() => {
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
  // Shown (with Cancel) right away, before the connection is even made.
  onProgress({ sourceId: source.id, downloadedBytes: 0, totalBytes: null, percent: null, state: "downloading", message: "Connecting…" });

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
        aborted.throwIfAborted();
        return finishDownload(current, partPath, filePath, onProgress, null, signal);
      }
      return RESTART;
    }
    if (!response.ok || !response.body) {
      throw new Error(`Download failed (${response.status} ${response.statusText})`);
    }
    // An error or sign-in page served as "200 OK" (a captive portal, a moved file): the partial
    // download, if any, stays untouched for a later resume.
    if (isHtmlContentType(response.headers.get("content-type"))) {
      await response.body.cancel();
      throw new InvalidDatasetError(current, "the server sent a web page instead of the data");
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
    // Without a Content-Length, a resumed response's Content-Range still gives the full size.
    const totalBytes =
      remainingBytes !== null
        ? startBytes + remainingBytes
        : resumed
          ? rangeSize(response.headers.get("content-range"))
          : null;
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
    // Cancelled (e.g. quitting) just as the transfer ended: the complete `.part` stays for next time.
    aborted.throwIfAborted();
    return finishDownload(current, partPath, filePath, onProgress, totalBytes, signal);
  }
}

/**
 * Installs a complete `.part` file. Its start is checked first (an error page or a foreign file
 * must not replace a working database), then it is swapped in so that any failure can be undone:
 * the installed file is kept as `.bak`, the new one takes its place, and only once it is registered
 * is the `.bak` deleted. If the check fails, nothing is touched but the bad `.part` (deleted, so the
 * next attempt starts over). If registering fails or the download is cancelled after the swap, the
 * old file comes back and the new one returns to `.part` with its `.validator`, so downloading
 * again finishes at once (the server confirms it is complete) instead of fetching it all again.
 */
async function finishDownload(
  source: (typeof externalDatabaseSources)[number],
  partPath: string,
  filePath: string,
  onProgress: ProgressSink,
  totalBytes: number | null,
  signal: AbortSignal
): Promise<InstalledDatabase> {
  const validatorPath = `${partPath}.validator`;
  const backupPath = backupPathFor(filePath);
  const stopIfCancelled = () => {
    // Quitting (even after it stopped waiting for this download) — the database may be closed by
    // now — or Cancel was pressed: this download installs nothing.
    if (shuttingDown) throw new DownloadCancelledError();
    signal.throwIfAborted();
  };
  stopIfCancelled();
  try {
    await validateDataset(source, partPath);
  } catch (error) {
    if (error instanceof InvalidDatasetError) {
      await unlink(partPath).catch(() => undefined);
      await unlink(validatorPath).catch(() => undefined);
    }
    throw error;
  }
  stopIfCancelled();
  await settleBackup(filePath);

  // A second name for the installed file (a copy where hard links aren't supported), so the file
  // never goes missing while it is replaced: a listing or a puzzle request meanwhile still finds it.
  const hadInstalled = existsSync(filePath);
  if (hadInstalled) await keepAside(filePath, backupPath);
  let promoted = false;
  try {
    await rename(partPath, filePath);
    promoted = true;
    const file = await stat(filePath);
    stopIfCancelled();
    // Registered first: "completed" is only announced for a database Puzzles can use.
    const installed = externalDatabaseRepository.saveDownloaded({
      source,
      filePath,
      fileSizeBytes: file.size,
      recordCount: source.expectedRecords ?? null
    });
    await unlink(backupPath).catch(() => undefined);
    await unlink(validatorPath).catch(() => undefined);
    dropPools(installed.id);
    onProgress({
      sourceId: source.id,
      downloadedBytes: file.size,
      totalBytes: totalBytes ?? file.size,
      percent: 100,
      state: "completed"
    });
    return installed;
  } catch (error) {
    try {
      if (promoted) await rename(filePath, partPath);
      if (hadInstalled) await rename(backupPath, filePath);
    } catch (restoreError) {
      // The `.bak` stays: the next download or listing puts it back (see `settleBackup`).
      logger.warn("databases", `restoring ${source.name} after a failed install failed:`, errorMessage(restoreError));
    }
    throw error;
  }
}

/** Where an installed file waits while a new download replaces it. */
function backupPathFor(filePath: string): string {
  return `${filePath}.bak`;
}

async function keepAside(filePath: string, backupPath: string): Promise<void> {
  await unlink(backupPath).catch(() => undefined);
  try {
    await link(filePath, backupPath);
  } catch {
    await copyFile(filePath, backupPath, constants.COPYFILE_FICLONE);
  }
}

/**
 * A `.bak` left by an install that was interrupted (the app crashed or was killed mid-swap): put
 * back when the file itself is missing, otherwise stale and deleted. Run before an install of
 * that file (downloads of one source never overlap) and by `onDisk` for a missing file.
 */
async function settleBackup(filePath: string): Promise<void> {
  const backupPath = backupPathFor(filePath);
  if (!existsSync(backupPath)) return;
  if (existsSync(filePath)) await unlink(backupPath).catch(() => undefined);
  else await rename(backupPath, filePath);
}

/**
 * Deletes the file (and any partial download) first, then the entry: a file that can't be deleted
 * (in use, no permission) keeps its entry, so it isn't left behind unlisted, and Delete can be retried.
 */
export async function removeDatabase(id: string): Promise<void> {
  const database = externalDatabaseRepository.get(id);
  if (!database) return;
  const { sourceId } = database;
  // A download of it (Download again) stops first: it would write to files being deleted. Taken
  // now, before downloads of it start waiting for this removal (waiting for one would never end).
  const running = inFlight.get(sourceId);
  running?.controller.abort(new DownloadCancelledError());
  const previous = removals.get(sourceId);
  const removal = (async () => {
    await previous?.catch(() => undefined);
    await running?.promise.catch(() => undefined);
    // The partial files first: if one can't go, the dataset itself (and its entry) are still intact.
    const paths = [`${database.filePath}.part.validator`, `${database.filePath}.part`, backupPathFor(database.filePath), database.filePath];
    for (const path of paths) {
      await unlink(path).catch((error: unknown) => {
        if (!isMissingFile(error)) throw error;
      });
    }
    externalDatabaseRepository.remove(database.id);
    dropPools(database.id);
  })().finally(() => {
    if (removals.get(sourceId) === removal) removals.delete(sourceId);
  });
  removals.set(sourceId, removal);
  await removal;
}

/*
 * How puzzles are drawn. Every scan of a dataset runs in a worker thread (decompressing the whole
 * Lichess file takes seconds of CPU), never in the main process; a scanner that can't run is an
 * error the caller sees, not a reason to scan here instead.
 *
 * Per database file and filter set there is a pool. Cold (an empty pool): the request waits for a
 * quick scan that stops after the first QUICK_MATCHES matches (plus as many as the session has
 * excluded, so fresh ones remain) and keeps a random POOL_SIZE of them. Those rows are the pool's
 * interim sample — a prefix of the file — and serve this and the following requests while a scan
 * of the whole file (queued, at most MAX_FULL_SCANS at once, newest filters first) builds a uniform
 * reservoir; that replaces the interim rows, and is refilled the same way when it runs low. When
 * the quick scan reaches the end of the file (rare filters, or none matching) it saw every match,
 * so it is the full answer and no whole-file scan follows.
 *
 * Identical requests in flight share one quick scan; a request for other filters stops the quick
 * scans of earlier ones (those requests fail as replaced), since only the newest one is waited for.
 */

/** Whole-file scans running at once, each decompressing the file in its own worker. */
const MAX_FULL_SCANS = 2;
/** A failed whole-file scan is tried again by a request at least this long after the failure. */
const FULL_SCAN_RETRY_MS = 30_000;

type QuickScan = RunningScan & { limit: number };

type SamplePool = {
  key: string;
  /** Candidate rows still to serve, a uniform sample of every match in the file. */
  rows: string[][];
  /**
   * When the file has no more matches than a pool holds: every one of them. Serving takes rows
   * out of `rows`; this set refills it (a new session may exclude fewer puzzles than the last).
   */
  all: string[][] | null;
  /** From the latest quick scan, while `rows` waits for a whole-file scan (see above). */
  interim: string[][];
  /** Quick scans in flight, joined by identical requests. */
  quick: Set<QuickScan>;
  /** The job of the whole-file scan, running (`full`) or waiting for a free slot (`queued`). */
  fullJob: ScanJob | null;
  full: RunningScan | null;
  queued: boolean;
  /** When the last whole-file scan failed: it is retried once FULL_SCAN_RETRY_MS have passed. */
  fullFailedAt: number | null;
};

/** Per database + filters. A small pool, filled from one scan of the whole file, serves many puzzles. */
const pools = new Map<string, SamplePool>();
/** Pools waiting for a whole-file scan; the newest is started first. */
const fullScanQueue: SamplePool[] = [];
let runningFullScans = 0;

/** The worker bundled next to the main entry (see electron.vite.config.ts). */
const SCAN_WORKER = join(dirname(fileURLToPath(import.meta.url)), "puzzle-scan-worker.js");
let scanner: PuzzleScanner = workerScanner(SCAN_WORKER);

/** Replaces the worker scanner (tests run scans in their own thread); null restores the worker. */
export function setPuzzleScanner(next: PuzzleScanner | null): void {
  scanner = next ?? workerScanner(SCAN_WORKER);
}

/** A scan whose `cancel` rejects its result at once, whatever the scanner does to stop. */
function startScan(job: ScanJob): RunningScan {
  const running = scanner(job);
  let stop: () => void = () => undefined;
  const stopped = new Promise<never>((_, reject) => (stop = () => reject(new ScanCancelledError())));
  return {
    result: Promise.race([running.result, stopped]),
    cancel: () => {
      stop();
      running.cancel();
    }
  };
}

/** Per database, file version (a replaced file is a new pool) and filters. */
function poolKey(input: PuzzleSampleInput, fileVersion: string): string {
  return JSON.stringify([input.databaseId, fileVersion, input.lichess ?? null, input.position ?? null]);
}

function poolFor(key: string): SamplePool {
  const existing = pools.get(key);
  if (existing) return existing;
  const pool: SamplePool = { key, rows: [], all: null, interim: [], quick: new Set(), fullJob: null, full: null, queued: false, fullFailedAt: null };
  pools.set(key, pool);
  // Oldest filter sets go first (their scans stop).
  for (const oldKey of [...pools.keys()]) {
    if (pools.size <= MAX_POOLS) break;
    dropPool(oldKey);
  }
  return pool;
}

function dropPool(key: string): void {
  const pool = pools.get(key);
  if (!pool) return;
  pools.delete(key);
  for (const quick of pool.quick) quick.cancel();
  pool.full?.cancel();
  const queued = fullScanQueue.indexOf(pool);
  if (queued >= 0) fullScanQueue.splice(queued, 1);
}

function dropPools(databaseId: string): void {
  for (const key of [...pools.keys()]) if (JSON.parse(key)[0] === databaseId) dropPool(key);
}

/** A request for other filters: earlier requests' quick scans stop (their whole-file scans go on). */
function supersedeQuickScans(current: SamplePool): void {
  for (const pool of pools.values()) {
    if (pool === current) continue;
    for (const quick of pool.quick) quick.cancel();
  }
}

/** The shared quick scan of at least `limit` matches, started if none is in flight. */
function quickScan(pool: SamplePool, job: ScanJob, limit: number): QuickScan {
  for (const quick of pool.quick) if (quick.limit >= limit) return quick;
  const quick: QuickScan = { ...startScan({ ...job, maxMatches: limit }), limit };
  pool.quick.add(quick);
  const forget = () => void pool.quick.delete(quick);
  quick.result.then(forget, forget);
  return quick;
}

/** Queues a whole-file scan when the pool runs low (not after a recent failure). */
function requestFullScan(pool: SamplePool, job: ScanJob): void {
  if (pool.all || pool.rows.length >= POOL_REFILL_BELOW || pool.full || pool.queued) return;
  if (pool.fullFailedAt !== null && Date.now() - pool.fullFailedAt < FULL_SCAN_RETRY_MS) return;
  pool.fullJob = job;
  pool.queued = true;
  fullScanQueue.push(pool);
  pumpFullScans();
}

function pumpFullScans(): void {
  while (runningFullScans < MAX_FULL_SCANS && fullScanQueue.length) {
    const pool = fullScanQueue.pop()!;
    pool.queued = false;
    if (pools.get(pool.key) !== pool || !pool.fullJob) continue;
    runningFullScans += 1;
    const scan = startScan(pool.fullJob);
    pool.full = scan;
    scan.result
      .then((result) => {
        if (pools.get(pool.key) !== pool) return;
        fillPool(pool, result);
        pool.fullFailedAt = null;
      })
      .catch((error: unknown) => {
        if (error instanceof ScanCancelledError || pools.get(pool.key) !== pool) return; // Dropped.
        // Puzzles keep coming from the interim rows (or new quick scans); tried again later.
        pool.fullFailedAt = Date.now();
        logger.warn("databases", "scanning a puzzle database in full failed:", errorMessage(error));
      })
      .finally(() => {
        pool.full = null;
        runningFullScans -= 1;
        pumpFullScans();
      });
  }
}

/** Takes a row that makes a puzzle from the pool: its whole-file sample first, else the interim one. */
function serveFromPool(pool: SamplePool, build: (row: string[]) => PuzzleSample | null): PuzzleSample | null {
  let sample = takeFromPool(pool, build);
  if (!sample && pool.all) {
    // Every match is known: serve them again (the excluded ones are skipped).
    pool.rows = [...pool.all];
    sample = takeFromPool(pool, build);
  }
  return sample ?? takeFromPool({ rows: pool.interim }, build);
}

/** What a failed scan means for the person asking for a puzzle. */
function sampleError(database: InstalledDatabase, error: unknown): Error {
  if (error instanceof ScanCancelledError) return new Error("This puzzle search was replaced by a newer one.");
  if (error instanceof ScanWorkerError) {
    return new Error(`Couldn't search ${database.name} for puzzles: ${error.message}. Try again, or restart Chaturanga if it keeps happening.`);
  }
  return new Error(`Couldn't read ${database.name}: ${errorMessage(error)}. Download the database again.`);
}

/**
 * A random puzzle matching the filters, drawn from the whole file (see the comment above `pools`
 * for how a new set of filters is answered while the file is scanned in the background).
 */
export async function samplePuzzle(input: PuzzleSampleInput): Promise<PuzzleSample> {
  const registered = externalDatabaseRepository.get(input.databaseId);
  if (!registered) throw new Error("Puzzle database not found. Download a database first.");
  const database = await onDisk(registered);
  if (!database) {
    dropPools(registered.id);
    throw new Error(`${registered.name} is missing from disk. Download the database again.`);
  }

  const kind: PuzzleRowKind = rowKindForSource(database.sourceId);
  const excluded = new Set(input.excludeIds ?? []);
  const file = await stat(database.filePath);
  const pool = poolFor(poolKey(input, `${file.size}:${file.mtimeMs}`));
  supersedeQuickScans(pool);
  const job: ScanJob = {
    filePath: database.filePath,
    compressed: database.format.endsWith(".zst"),
    kind,
    input,
    // Exclusions are applied when serving, so the rows fit any session with these filters.
    excludeIds: [],
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

  // Several candidates, so a malformed or excluded row (checked only when serving) doesn't hide
  // the valid ones; the excluded rows count towards the limit, so it still reaches fresh ones.
  const limit = QUICK_MATCHES + excluded.size;
  let scanned = 0;
  let sample = serveFromPool(pool, build);
  // A joined scan may have stopped short of this request's limit: then one more, of its own.
  while (!sample && !pool.all && scanned < limit) {
    const quick = quickScan(pool, job, limit);
    let result: ScanResult;
    try {
      result = await quick.result;
    } catch (error) {
      if (!(error instanceof ScanCancelledError)) {
        logger.warn("databases", `scanning ${database.name} for puzzles failed:`, errorMessage(error));
      }
      throw sampleError(database, error);
    }
    // A scan that reached the end of the file saw every match: no larger one would find more.
    scanned = result.complete ? Infinity : quick.limit;
    // It read the whole file (few matches, or none): that is the pool a full scan would give.
    if (result.complete) fillPool(pool, result);
    else pool.interim = [...result.rows];
    sample = serveFromPool(pool, build);
  }
  requestFullScan(pool, job);
  if (!sample) throw new Error("No puzzle matched those filters. Try fewer themes or a wider rating range.");
  return sample;
}

/** A scan's rows become the pool; a complete scan with few matches holds every one of them. */
function fillPool(pool: SamplePool, result: ScanResult): void {
  pool.rows = result.rows;
  pool.interim = [];
  if (result.complete && result.matches <= POOL_SIZE) pool.all = [...result.rows];
}

/** Takes random rows out of the pool until one makes a puzzle (excluded or broken rows are dropped). */
function takeFromPool(pool: Pick<SamplePool, "rows">, build: (row: string[]) => PuzzleSample | null): PuzzleSample | null {
  while (pool.rows.length) {
    const index = Math.floor(Math.random() * pool.rows.length);
    const [row] = pool.rows.splice(index, 1);
    const sample = row ? build(row) : null;
    if (sample) return sample;
  }
  return null;
}

/** The full length a 416 reports (`Content-Range: bytes` + `*` + `/N`); null when absent or malformed. */
function rangeTotal(value: string | null): number | null {
  const match = /^bytes \*\/(\d+)$/.exec(value?.trim() ?? "");
  return match ? Number(match[1]) : null;
}

/** The full size a 206 reports (`Content-Range: bytes START-END/TOTAL`); null when absent or `*`. */
function rangeSize(value: string | null): number | null {
  const match = /^bytes \d+-\d+\/(\d+)$/.exec(value?.trim() ?? "");
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
