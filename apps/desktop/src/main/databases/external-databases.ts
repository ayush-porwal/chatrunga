import { app } from "electron";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
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
import { parseCsvLine, sampleFromLichessRow, sampleFromPositionRow } from "./puzzle-rows";

const PROGRESS_INTERVAL_MS = 120;
/** Reservoir-sample among at most this many matches (keeps a scan of a huge file short). */
const MAX_MATCHES_TO_SAMPLE = 500;

type ProgressSink = (progress: DatabaseDownloadProgress) => void;

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

/** Installed databases whose file is still on disk; rows for deleted files are dropped. */
export async function listInstalledDatabases(): Promise<InstalledDatabase[]> {
  const available: InstalledDatabase[] = [];
  for (const database of externalDatabaseRepository.list()) {
    try {
      await stat(database.filePath);
      available.push(database);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      externalDatabaseRepository.remove(database.id);
    }
  }
  return available;
}

/** Streams a catalogued source into `userData/databases`, reporting progress. */
export async function downloadDatabase(sourceId: string, onProgress: ProgressSink): Promise<InstalledDatabase> {
  const source = externalDatabaseSources.find((item) => item.id === sourceId);
  if (!source) throw new Error("Database source not found");
  const dir = join(app.getPath("userData"), "databases");
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${source.id}-${basename(new URL(source.url).pathname)}`);

  const response = await fetch(source.url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status} ${response.statusText})`);
  }
  const totalBytes = parseContentLength(response.headers.get("content-length"));
  let downloadedBytes = 0;
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
    await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(filePath));
  } catch (error) {
    await unlink(filePath).catch(() => undefined);
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
  const database = externalDatabaseRepository.get(input.databaseId);
  if (!database) throw new Error("Puzzle database not found. Download a database first.");
  try {
    await stat(database.filePath);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    externalDatabaseRepository.remove(database.id);
    throw new Error(`${database.name} is missing from disk. Download the database again.`, { cause: error });
  }

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
