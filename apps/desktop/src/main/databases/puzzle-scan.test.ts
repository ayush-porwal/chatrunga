import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { reservoirScan, scanCsvLines } from "./puzzle-scan";

/** A zstd skippable frame (magic 0x184D2A50, little-endian length, payload), as pzstd writes. */
function skippableFrame(payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(0x184d2a50, 0);
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function tempFile(name: string, contents: Buffer | string): string {
  const path = join(mkdtempSync(join(tmpdir(), "chaturanga-scan-")), name);
  writeFileSync(path, contents);
  return path;
}

async function readLines(path: string, compressed: boolean): Promise<string[]> {
  const lines: string[] = [];
  await scanCsvLines(path, compressed, (line) => {
    lines.push(line);
  });
  return lines;
}

const CSV = ["PuzzleId,FEN,Moves,Rating", ...Array.from({ length: 2000 }, (_, i) => `p${i},fen ${i},e2e4 e7e5,${1000 + i}`)].join("\n");

describe("scanCsvLines", () => {
  it.each([true, false])("fails instead of hanging when the file can't be read (compressed: %s)", async (compressed) => {
    // A directory opens but every read fails (EISDIR).
    const directory = mkdtempSync(join(tmpdir(), "chaturanga-scan-"));
    await expect(scanCsvLines(directory, compressed, () => undefined)).rejects.toThrow();
  });

  it("reads every frame of a multi-frame file that starts with a skippable frame (pzstd, Lichess)", async () => {
    // Frames cut mid-line, so a line spans a frame boundary too.
    const text = Buffer.from(CSV);
    const cuts = [0, 1234, 20_000, 33_333, text.length];
    const frames = cuts.slice(1).map((end, i) => zstdCompressSync(text.subarray(cuts[i], end)));
    const path = tempFile(
      "multi.csv.zst",
      Buffer.concat([skippableFrame(Buffer.from("pzstd index")), frames[0]!, skippableFrame(Buffer.alloc(4)), ...frames.slice(1)])
    );
    expect(await readLines(path, true)).toEqual(CSV.split("\n"));
  });

  it("stops early without reading the rest", async () => {
    const path = tempFile("one.csv.zst", Buffer.concat([zstdCompressSync(Buffer.from(CSV.slice(0, 5000))), zstdCompressSync(Buffer.from(CSV.slice(5000)))]));
    const seen: string[] = [];
    await scanCsvLines(path, true, (line) => {
      seen.push(line);
      return seen.length < 3;
    });
    expect(seen).toHaveLength(3);
  });

  it("rejects a corrupt frame instead of reporting a short file", async () => {
    const good = zstdCompressSync(Buffer.from(CSV));
    const corrupt = Buffer.from(good);
    corrupt.fill(0x41, 20, 60);
    const path = tempFile("bad.csv.zst", Buffer.concat([zstdCompressSync(Buffer.from("PuzzleId,FEN\n")), corrupt]));
    await expect(readLines(path, true)).rejects.toThrow();
  });
});

describe("reservoirScan", () => {
  it("a file nothing could be read from is an error, not an empty result", async () => {
    // Only a skippable frame: a valid zstd file with no content.
    const path = tempFile("empty.csv.zst", skippableFrame(Buffer.from("nothing here")));
    await expect(
      reservoirScan({ filePath: path, compressed: true, kind: "lichess", input: {} as never, excludeIds: [], size: 10 })
    ).rejects.toThrow(/No lines could be read/);
  });
});
