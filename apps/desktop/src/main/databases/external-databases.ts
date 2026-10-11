import { app } from "electron";
import { constants, createWriteStream, existsSync } from "node:fs";
import { copyFile, link, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  externalDatabaseSources,
  type DatabaseDownloadProgress,
  type InstalledDatabase
} from "@chaturanga/shared/types/database";
import { externalDatabaseRepository } from "../db/external-database-repository";
import { errorMessage, logger } from "../logger";
import { datasetDir } from "./dataset-location";
import { InvalidDatasetError, isHtmlContentType, validateDataset } from "./dataset-validation";
import {
  backupPathFor,
  fileSize,
  installMarkerFor,
  isMissingFile,
  settleBackup
} from "./installed-databases";
import { dropPools } from "./puzzle-sampling";
import { readableFromBody } from "../web-stream";

const PROGRESS_INTERVAL_MS = 120;
/** A download with no data for this long is abandoned (its `.part` file stays for a resume). */
const STALL_TIMEOUT_MS = 60_000;
/** How long quitting waits for cancelled downloads to close their files. */
const CANCEL_TIMEOUT_MS = 3_000;
type ProgressSink = (progress: DatabaseDownloadProgress) => void;

/** Downloads in flight, per source: a second request for the same database joins the first. */
const inFlight = new Map<
  string,
  { promise: Promise<InstalledDatabase>; controller: AbortController }
>();
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
export function downloadDatabase(
  sourceId: string,
  onProgress: ProgressSink
): Promise<InstalledDatabase> {
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

type DatabaseSource = (typeof externalDatabaseSources)[number];

/** One download's source, its files (the `.part` is installed as `filePath`), and who hears of it. */
type DownloadTarget = {
  source: DatabaseSource;
  filePath: string;
  partPath: string;
  onProgress: ProgressSink;
  /** Cancel (or quitting) aborts it. */
  signal: AbortSignal;
};

async function runDownload(
  sourceId: string,
  onProgress: ProgressSink,
  signal: AbortSignal
): Promise<InstalledDatabase> {
  const source = externalDatabaseSources.find((item) => item.id === sourceId);
  if (!source) throw new Error("Database source not found");
  const dir = datasetDir(app.getPath("userData"));
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${source.id}-${basename(new URL(source.url).pathname)}`);
  const partPath = `${filePath}.part`;
  // An earlier install of this file that was interrupted is undone first: its new copy goes back to
  // `.part` (this download then finishes at once) and the installed copy comes back from `.bak`.
  await settleBackup(filePath, externalDatabaseRepository.getBySource(source.id));
  // The server's ETag / Last-Modified for the `.part` file: a resume only continues the same file.
  const validatorPath = `${partPath}.validator`;
  const target: DownloadTarget = { source, filePath, partPath, onProgress, signal };

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
  onProgress({
    sourceId: source.id,
    downloadedBytes: 0,
    totalBytes: null,
    percent: null,
    state: "downloading",
    message: "Connecting…"
  });

  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await downloadOnce();
      if (result !== RESTART) return result;
      await unlink(partPath).catch(() => undefined);
      await unlink(validatorPath).catch(() => undefined);
    }
    throw new Error("The download couldn't be resumed. Try again later.");
  } catch (error) {
    const reason: unknown = aborted.aborted ? aborted.reason : error;
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
    const validator = (await readFile(validatorPath, "utf8").catch(() => "")).trim();
    if (!validator) {
      // A partial with no recorded version can't be continued safely: start over.
      await unlink(partPath).catch(() => undefined);
    }
    const offset = validator ? await fileSize(partPath) : 0;
    // If-Range: the server sends the rest only if the file is unchanged, otherwise all of it (200).
    const response = await fetch(
      target.source.url,
      offset
        ? {
            headers: { ...IDENTITY, Range: `bytes=${offset}-`, "If-Range": validator },
            signal: aborted
          }
        : { headers: IDENTITY, signal: aborted }
    );
    touch();
    if (response.status === 416 && offset) {
      await response.body?.cancel();
      // Same version, nothing past `offset`: complete only if it is exactly the file's length.
      if (rangeTotal(response.headers.get("content-range")) === offset) {
        aborted.throwIfAborted();
        return finishDownload(target, null);
      }
      return RESTART;
    }
    const body = await writableBody(response, offset, target.source);
    if (!body) return RESTART;
    // 206: the server continues after `offset`; 200: a new version, or no range asked: start over.
    const resumed = response.status === 206;
    const startBytes = resumed ? offset : 0;
    if (!resumed) await recordValidator(validatorPath, response.headers);
    const totalBytes = expectedSize(response, startBytes);
    let downloadedBytes = startBytes;
    let lastEmitAt = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        touch();
        downloadedBytes += chunk.byteLength;
        const now = Date.now();
        if (now - lastEmitAt >= PROGRESS_INTERVAL_MS) {
          lastEmitAt = now;
          onProgress(downloadingProgress(target.source.id, downloadedBytes, totalBytes));
        }
        callback(null, chunk);
      }
    });

    // On failure the `.part` file stays, so the next attempt resumes instead of starting over.
    await pipeline(
      readableFromBody(body),
      meter,
      createWriteStream(partPath, { flags: resumed ? "a" : "w" }),
      { signal: aborted }
    );
    if (totalBytes !== null && downloadedBytes !== totalBytes) {
      throw new Error("The download ended early. Try again to resume it.");
    }
    // Cancelled (e.g. quitting) just as the transfer ended: the complete `.part` stays for next time.
    aborted.throwIfAborted();
    return finishDownload(target, totalBytes);
  }
}

/**
 * The body to write to the `.part` file, after checking the response can be: a failed request or
 * a web page throws; a 206 that doesn't continue where the partial file ends is null (start over).
 */
async function writableBody(
  response: Response,
  offset: number,
  source: DatabaseSource
): Promise<ReadableStream<Uint8Array> | null> {
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status} ${response.statusText})`);
  }
  // An error or sign-in page served as "200 OK" (a captive portal, a moved file): the partial
  // download, if any, stays untouched for a later resume.
  if (isHtmlContentType(response.headers.get("content-type"))) {
    await response.body.cancel();
    throw new InvalidDatasetError(source, "the server sent a web page instead of the data");
  }
  // A 206 must continue exactly where the partial file ends, or the bytes would be misplaced.
  if (response.status === 206 && rangeStart(response.headers.get("content-range")) !== offset) {
    await response.body.cancel();
    return null;
  }
  return response.body;
}

/** A new version starts: its ETag / Last-Modified is what a later resume must match. */
async function recordValidator(validatorPath: string, headers: Headers): Promise<void> {
  const validator = headers.get("etag") ?? headers.get("last-modified");
  if (validator) await writeFile(validatorPath, validator);
  else await unlink(validatorPath).catch(() => undefined);
}

/** The whole file's size, when the response tells; `startBytes` are already in the `.part`. */
function expectedSize(response: Response, startBytes: number): number | null {
  const remainingBytes = parseContentLength(response.headers.get("content-length"));
  if (remainingBytes !== null) return startBytes + remainingBytes;
  // Without a Content-Length, a resumed response's Content-Range still gives the full size.
  return response.status === 206 ? rangeSize(response.headers.get("content-range")) : null;
}

function downloadingProgress(
  sourceId: string,
  downloadedBytes: number,
  totalBytes: number | null
): DatabaseDownloadProgress {
  return {
    sourceId,
    downloadedBytes,
    totalBytes,
    percent: totalBytes ? Math.min(99, Math.round((downloadedBytes / totalBytes) * 100)) : null,
    state: "downloading"
  };
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
  { source, filePath, partPath, onProgress, signal }: DownloadTarget,
  totalBytes: number | null
): Promise<InstalledDatabase> {
  const validatorPath = `${partPath}.validator`;
  const backupPath = backupPathFor(filePath);
  const markerPath = installMarkerFor(filePath);
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
  await settleBackup(filePath, externalDatabaseRepository.getBySource(source.id));

  // A second name for the installed file (a copy where hard links aren't supported), so the file
  // never goes missing while it is replaced: a listing or a puzzle request meanwhile still finds it.
  const hadInstalled = existsSync(filePath);
  // On disk until the swap is final, holding the new copy's size: if the app dies before the new copy
  // is registered, the next listing or download undoes the swap (see settleBackup) rather than
  // keeping a copy the registry doesn't describe.
  await writeFile(markerPath, String((await stat(partPath)).size));
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
    // Registered: the swap is final (from here on, a stray `.bak` is just stale).
    await unlink(markerPath).catch(() => undefined);
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
      await unlink(markerPath).catch(() => undefined);
    } catch (restoreError) {
      // The marker and `.bak` stay: the next download or listing undoes the swap (see `settleBackup`).
      logger.warn(
        "databases",
        `restoring ${source.name} after a failed install failed:`,
        errorMessage(restoreError)
      );
    }
    throw error;
  }
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
    const paths = [
      `${database.filePath}.part.validator`,
      `${database.filePath}.part`,
      backupPathFor(database.filePath),
      installMarkerFor(database.filePath),
      database.filePath
    ];
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
