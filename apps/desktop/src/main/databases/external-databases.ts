import { app } from "electron";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Decompress } from "fzstd";
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
import { parseCsvLine, sampleFromLichessRow, sampleFromPositionRow } from "./puzzle-rows";

const PROGRESS_INTERVAL_MS = 120;
/** Reservoir-sample among at most this many matches (keeps a scan of a huge file short). */
const MAX_MATCHES_TO_SAMPLE = 500;

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
const inFlight = new Map<string, Promise<InstalledDatabase>>();

/**
 * Streams a catalogued source into `userData/databases`, reporting progress. The data goes to a
 * `.part` file that is renamed into place only once complete, and a download cut short (the app
 * quit, e.g. to install an update, or the network dropped) resumes from where it stopped — but only
 * a partial whose server version (ETag / Last-Modified) was recorded, so two versions never mix.
 */
export function downloadDatabase(sourceId: string, onProgress: ProgressSink): Promise<InstalledDatabase> {
  const running = inFlight.get(sourceId);
  if (running) return running;
  const download = runDownload(sourceId, onProgress).finally(() => inFlight.delete(sourceId));
  inFlight.set(sourceId, download);
  return download;
}

/** Byte offsets must address the file as stored, so no transfer encoding (gzip) may apply. */
const IDENTITY = { "Accept-Encoding": "identity" };

async function runDownload(sourceId: string, onProgress: ProgressSink): Promise<InstalledDatabase> {
  const source = externalDatabaseSources.find((item) => item.id === sourceId);
  if (!source) throw new Error("Database source not found");
  const dir = datasetDir(app.getPath("userData"));
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${source.id}-${basename(new URL(source.url).pathname)}`);
  const partPath = `${filePath}.part`;
  // The server's ETag / Last-Modified for the `.part` file: a resume only continues the same file.
  const validatorPath = `${partPath}.validator`;

  const validator = (await readFile(validatorPath, "utf8").catch(() => "")).trim();
  if (!validator) {
    // A partial with no recorded version can't be continued safely: start over.
    await unlink(partPath).catch(() => undefined);
  }
  const offset = validator ? await fileSize(partPath) : 0;
  // If-Range: the server sends the rest only if the file is unchanged, otherwise all of it (200).
  const response = await fetch(
    source.url,
    offset ? { headers: { ...IDENTITY, Range: `bytes=${offset}-`, "If-Range": validator } } : { headers: IDENTITY }
  );
  if (response.status === 416 && offset) {
    await response.body?.cancel();
    // Same version, nothing past `offset`: complete only if it is exactly the file's length.
    if (rangeTotal(response.headers.get("content-range")) === offset) {
      return finishDownload(source, partPath, filePath, onProgress, null);
    }
    await unlink(partPath).catch(() => undefined);
    await unlink(validatorPath).catch(() => undefined);
    return runDownload(sourceId, onProgress);
  }
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status} ${response.statusText})`);
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
      downloadedBytes += chunk.byteLength;
      const now = Date.now();
      if (now - lastEmitAt >= PROGRESS_INTERVAL_MS) {
        lastEmitAt = now;
        onProgress({
          sourceId: source.id,
          downloadedBytes,
          totalBytes,
          percent: totalBytes ? Math.min(99, Math.round((downloadedBytes / totalBytes) * 100)) : null,
          state: "downloading"
        });
      }
      callback(null, chunk);
    }
  });

  try {
    await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(partPath, { flags: resumed ? "a" : "w" }));
  } catch (error) {
    // The `.part` file stays, so the next attempt resumes instead of starting over.
    onProgress({
      sourceId: source.id,
      downloadedBytes: 0,
      totalBytes,
      percent: null,
      state: "failed",
      message: errorMessage(error)
    });
    throw error;
  }
  return finishDownload(source, partPath, filePath, onProgress, totalBytes);
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
  onProgress({
    sourceId: source.id,
    downloadedBytes: file.size,
    totalBytes: totalBytes ?? file.size,
    percent: 100,
    state: "completed"
  });
  return externalDatabaseRepository.saveDownloaded({
    source,
    filePath,
    fileSizeBytes: file.size,
    recordCount: source.expectedRecords ?? null
  });
}

export async function removeDatabase(id: string): Promise<void> {
  const database = externalDatabaseRepository.get(id);
  if (!database) return;
  externalDatabaseRepository.remove(database.id);
  await unlink(database.filePath).catch((error: unknown) => {
    if (!isMissingFile(error)) throw error;
  });
}

/** A uniformly random puzzle among the first matches of the filters. */
export async function samplePuzzle(input: PuzzleSampleInput): Promise<PuzzleSample> {
  const registered = externalDatabaseRepository.get(input.databaseId);
  if (!registered) throw new Error("Puzzle database not found. Download a database first.");
  const database = await onDisk(registered);
  if (!database) throw new Error(`${registered.name} is missing from disk. Download the database again.`);

  const sampleRow = database.sourceId === "lichess-puzzles" ? sampleFromLichessRow : sampleFromPositionRow;
  const excludedIds = new Set(input.excludeIds ?? []);
  let selected: PuzzleSample | null = null;
  let matches = 0;
  await scanCsvLines(database.filePath, database.format.endsWith(".zst"), (line, lineIndex) => {
    if (lineIndex === 0 || !line.trim()) return;
    let sample: PuzzleSample | null;
    try {
      sample = sampleRow(database, parseCsvLine(line), input);
    } catch {
      return; // Malformed row (e.g. an illegal FEN): skip it.
    }
    if (!sample || excludedIds.has(sample.id)) return;
    matches += 1;
    if (Math.random() < 1 / matches) selected = sample;
    if (matches >= MAX_MATCHES_TO_SAMPLE) return false;
  });

  if (!selected) throw new Error("No puzzle matched those filters. Try fewer themes or a wider rating range.");
  return selected;
}

/** The full length a 416 reports (`Content-Range: bytes` + `*` + `/N`); null when absent or malformed. */
function rangeTotal(value: string | null): number | null {
  const match = /^bytes \*\/(\d+)$/.exec(value?.trim() ?? "");
  return match ? Number(match[1]) : null;
}

function parseContentLength(value: string | null): number | null {
  const parsed = Number(value);
  return value && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Calls `onLine` for every line of a (optionally zstd-compressed) text file until it returns false. */
async function scanCsvLines(
  filePath: string,
  compressed: boolean,
  onLine: (line: string, lineIndex: number) => boolean | void
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  let lineIndex = 0;
  let stopped = false;
  const emitText = (text: string) => {
    if (stopped) return;
    buffer += text;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (onLine(line, lineIndex++) === false) {
        stopped = true;
        return;
      }
    }
  };

  if (compressed) {
    const decompressor = new Decompress((chunk, final) => emitText(decoder.decode(chunk, { stream: !final })));
    for await (const chunk of createReadStream(filePath)) {
      decompressor.push(chunk as Buffer, false);
      if (stopped) break;
    }
    if (!stopped) decompressor.push(new Uint8Array(), true);
  } else {
    for await (const chunk of createReadStream(filePath, { encoding: "utf8" })) {
      emitText(chunk as string);
      if (stopped) break;
    }
  }

  const tail = buffer.trim();
  if (!stopped && tail) onLine(tail, lineIndex);
}
