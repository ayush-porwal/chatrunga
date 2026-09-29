/**
 * Streaming scans of a puzzle / position CSV (optionally zstd-compressed). Pure Node — no Electron —
 * so the same code runs in the main process and in the background scan worker.
 */
import { createReadStream } from "node:fs";
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
  await scanCsvLines(job.filePath, job.compressed, (line, lineIndex) => {
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

  const file = createReadStream(filePath);
  try {
    if (compressed && typeof createZstdDecompress === "function") {
      // Native zstd (Node ≥ 22.15): decompresses on libuv's thread pool, far faster than JS.
      const decompressed = file.pipe(createZstdDecompress());
      for await (const chunk of decompressed) {
        emitText(decoder.decode(chunk as Buffer, { stream: true }));
        if (stopped) {
          decompressed.destroy();
          break;
        }
      }
    } else if (compressed) {
      const decompressor = new Decompress((chunk, final) => emitText(decoder.decode(chunk, { stream: !final })));
      for await (const chunk of file) {
        decompressor.push(chunk as Buffer, false);
        if (stopped) break;
      }
      if (!stopped) decompressor.push(new Uint8Array(), true);
    } else {
      for await (const chunk of file) {
        emitText(decoder.decode(chunk as Buffer, { stream: true }));
        if (stopped) break;
      }
    }
  } finally {
    file.destroy();
  }

  const tail = (buffer + decoder.decode()).trim();
  if (!stopped && tail) onLine(tail, lineIndex);
}
