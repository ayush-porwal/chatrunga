/**
 * Streaming scans of a puzzle / position CSV (optionally zstd-compressed). Pure Node — no Electron —
 * so the same code runs in the main process and in the background scan worker.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream";
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
 */
export async function reservoirScan(job: ScanJob, isCancelled: () => boolean = () => false): Promise<ScanResult> {
  const excluded = new Set(job.excludeIds);
  const rows: string[][] = [];
  let matches = 0;
  let stopped = false;
  let lines = 0;
  await scanCsvLines(job.filePath, job.compressed, (line, lineIndex) => {
    lines += 1;
    if (lineIndex === 0 || !line.trim()) return;
    const row = parseCsvLine(line);
    if (excluded.has(row[0] ?? "") || !matchesCheapFilters(job.kind, row, job.input)) return;
    matches += 1;
    if (rows.length < job.size) rows.push(row);
    else {
      const slot = Math.floor(Math.random() * matches);
      if (slot < job.size) rows[slot] = row;
    }
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
