/**
 * Streaming scans of a puzzle / position CSV (optionally zstd-compressed). Pure Node — no Electron —
 * so the same code runs in the main process and in the background scan worker.
 */
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream";
import { Worker } from "node:worker_threads";
import { createZstdDecompress } from "node:zlib";
import { Decompress } from "fzstd";
import type { PuzzleSampleInput } from "@chaturanga/shared/types/database";
import { matchesCheapFilters, parseCsvLine, type PuzzleRowKind } from "./puzzle-rows";

export type ScanJob = {
  filePath: string;
  compressed: boolean;
  kind: PuzzleRowKind;
  input: PuzzleSampleInput;
  excludeIds: readonly string[];
  /** Rows to keep (a uniform sample of every match seen). */
  size: number;
  /** Stop after this many matches (a quick answer from the file's start); omit to scan it all. */
  maxMatches?: number;
};

export type ScanResult = {
  rows: string[][];
  /** Matching rows seen; when the whole file was scanned and this is ≤ `size`, `rows` holds all of them. */
  matches: number;
  complete: boolean;
};

/**
 * Keeps a uniform random sample (reservoir) of the rows that pass the cheap filters. The expensive
 * chess work (the position after the opponent's move) is left for the one row that gets used.
 * With `input.ids`, only those puzzles match, and the scan ends once all of them are found (as
 * complete as reading the rest); an empty list matches nothing, without reading the file.
 * `random` (uniform in [0, 1)) is Math.random in the app; tests pass a seeded one, so which rows
 * are kept is the same on every run.
 */
export async function reservoirScan(
  job: ScanJob,
  isCancelled: () => boolean = () => false,
  random: () => number = Math.random
): Promise<ScanResult> {
  const excluded = new Set(job.excludeIds);
  const wanted = job.input.ids ? new Set(job.input.ids) : null;
  if (wanted && !wanted.size) return { rows: [], matches: 0, complete: true };
  const rows: string[][] = [];
  let matches = 0;
  let stopped = false;
  let lines = 0;
  await scanCsvLines(job.filePath, job.compressed, (line, lineIndex) => {
    lines += 1;
    if (lineIndex === 0 || !line.trim()) return;
    const row = parseCsvLine(line);
    const id = row[0] ?? "";
    if (excluded.has(id) || (wanted && !wanted.has(id)) || !matchesCheapFilters(job.kind, row, job.input)) return;
    matches += 1;
    if (rows.length < job.size) rows.push(row);
    else {
      const slot = Math.floor(random() * matches);
      if (slot < job.size) rows[slot] = row;
    }
    // Ids are unique in a puzzle file: every wanted one is in hand.
    if (wanted && matches >= wanted.size) return false;
    if ((job.maxMatches !== undefined && matches >= job.maxMatches) || isCancelled()) {
      stopped = true;
      return false;
    }
  });
  // Not even a header: the file couldn't be read, which must not pass for "nothing matched".
  if (!lines && (await stat(job.filePath)).size > 0) {
    throw new Error(`No lines could be read from ${job.filePath}`);
  }
  return { rows, matches, complete: !stopped };
}

/** Calls `onLine` for every line of a (optionally zstd-compressed) text file until it returns false. */
export async function scanCsvLines(
  filePath: string,
  compressed: boolean,
  onLine: (line: string, lineIndex: number) => boolean | void
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  let lineIndex = 0;
  for await (const chunk of decompressedChunks(filePath, compressed)) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      // Breaking out ends the reads (and the decompression) of the rest of the file.
      if (onLine(line, lineIndex++) === false) return;
    }
  }
  const tail = (buffer + decoder.decode()).trim();
  if (tail) onLine(tail, lineIndex);
}

/**
 * The file's first line, reading (and decompressing) no more than `maxChars` of text — bounded work
 * however large or wrong the file is. Null when there is no line break within that much text (a CSV
 * header is far shorter). Rejects when the file can't be read or decompressed.
 */
export async function readFirstLine(filePath: string, compressed: boolean, maxChars = 64 * 1024): Promise<string | null> {
  const decoder = new TextDecoder();
  let text = "";
  let ended = true;
  for await (const chunk of decompressedChunks(filePath, compressed)) {
    text += decoder.decode(chunk, { stream: true });
    const newline = text.search(/\r?\n/);
    if (newline >= 0) return text.slice(0, newline);
    if (text.length > maxChars) {
      ended = false;
      break;
    }
  }
  if (!ended) return null;
  text += decoder.decode();
  return text.length ? text : null;
}

/** The file's bytes, zstd-decompressed when `compressed`; stopping early (a `break`) ends the reads. */
async function* decompressedChunks(filePath: string, compressed: boolean): AsyncGenerator<Uint8Array> {
  if (compressed && typeof createZstdDecompress === "function") {
    yield* nativeZstdFrames(filePath);
    return;
  }
  const file = createReadStream(filePath);
  try {
    if (!compressed) {
      for await (const chunk of file) yield chunk as Buffer;
      return;
    }
    const output: Uint8Array[] = [];
    const decompressor = new Decompress((chunk) => output.push(chunk));
    for await (const chunk of file) {
      decompressor.push(chunk as Buffer, false);
      yield* output.splice(0);
    }
    decompressor.push(new Uint8Array(), true);
    yield* output.splice(0);
  } finally {
    file.destroy();
  }
}

/**
 * Native zstd (Node ≥ 22.15, on libuv's thread pool, far faster than JS) over every frame of the
 * file. Node's decompressor ends after one frame, and files written by pzstd (the Lichess puzzle
 * database) are dozens of frames, starting with a skippable one — so each frame gets its own
 * decompressor, started where the previous one stopped consuming input. A decompression or read
 * error rejects; stopping early (the caller breaking out) just ends the reads.
 */
async function* nativeZstdFrames(filePath: string): AsyncGenerator<Buffer> {
  const { size } = await stat(filePath);
  let offset = 0;
  while (offset < size) {
    const file = createReadStream(filePath, { start: offset });
    const decompress = createZstdDecompress();
    let failure: unknown = null;
    const frames = pipeline(file, decompress, (error) => {
      if (error && (error as NodeJS.ErrnoException).code !== "ERR_STREAM_PREMATURE_CLOSE") failure = error;
    });
    try {
      for await (const chunk of frames) yield chunk as Buffer;
    } finally {
      file.destroy();
      decompress.destroy();
    }
    if (failure) throw failure;
    // Input the frame used (bytes read past its end aren't counted).
    const consumed = decompress.bytesWritten;
    if (consumed <= 0) throw new Error(`zstd: no frame at byte ${offset} of ${filePath}`);
    offset += consumed;
  }
}

/** A scan in progress: `cancel` stops it, and `result` then rejects with `ScanCancelledError`. */
export type RunningScan = { result: Promise<ScanResult>; cancel: () => void };

/** Runs a scan somewhere (the worker thread in the app; tests may run it in their own thread). */
export type PuzzleScanner = (job: ScanJob) => RunningScan;

export class ScanCancelledError extends Error {
  constructor() {
    super("The puzzle scan was stopped.");
    this.name = "ScanCancelledError";
  }
}

/** The scan worker is missing, crashed or stopped without an answer — not a problem with the file. */
export class ScanWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScanWorkerError";
  }
}

/** Longer than any whole-file scan takes: a worker silent for this long is stuck, and stopped. */
const WORKER_SCAN_TIMEOUT_MS = 5 * 60_000;

/**
 * Scans in a worker thread running `workerPath` (puzzle-scan-worker.ts, bundled next to the main
 * entry), one worker per scan. The result settles exactly once: with the worker's answer, or as a
 * `ScanWorkerError` when the file is missing, the worker throws, or it exits or stalls without
 * answering — so no caller waits forever.
 */
export function workerScanner(workerPath: string, timeoutMs = WORKER_SCAN_TIMEOUT_MS): PuzzleScanner {
  return (job) => {
    if (!existsSync(workerPath)) {
      return {
        result: Promise.reject(new ScanWorkerError(`the puzzle scanner (${workerPath}) is missing from this installation`)),
        cancel: () => undefined
      };
    }
    let finish: (outcome: { result: ScanResult } | { error: Error }) => void = () => undefined;
    const result = new Promise<ScanResult>((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker(workerPath, { workerData: job });
      } catch (error) {
        reject(new ScanWorkerError(`the puzzle scanner couldn't start (${error instanceof Error ? error.message : String(error)})`));
        return;
      }
      const timer = setTimeout(() => finish({ error: new ScanWorkerError("the puzzle scanner stopped responding") }), timeoutMs);
      let settled = false;
      finish = (outcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        if ("result" in outcome) resolve(outcome.result);
        else reject(outcome.error);
      };
      worker.once("message", (message: { ok: true; result: ScanResult } | { ok: false; message: string }) =>
        // A failed scan inside a working worker: the file couldn't be read.
        finish(message.ok ? { result: message.result } : { error: new Error(message.message) })
      );
      worker.once("error", (error: unknown) =>
        finish({ error: new ScanWorkerError(`the puzzle scanner crashed (${error instanceof Error ? error.message : String(error)})`) })
      );
      worker.once("exit", (code) =>
        // After any message still queued from the worker, which wins if there is one.
        setImmediate(() => finish({ error: new ScanWorkerError(`the puzzle scanner stopped without an answer (exit code ${code})`) }))
      );
    });
    return { result, cancel: () => finish({ error: new ScanCancelledError() }) };
  };
}
