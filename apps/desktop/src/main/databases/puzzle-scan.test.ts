import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  readFirstLine,
  reservoirScan,
  ScanCancelledError,
  ScanWorkerError,
  scanCsvLines,
  workerScanner,
  type ScanJob
} from "./puzzle-scan";

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

const CSV = [
  "PuzzleId,FEN,Moves,Rating",
  ...Array.from({ length: 2000 }, (_, i) => `p${i},fen ${i},e2e4 e7e5,${1000 + i}`)
].join("\n");

describe("scanCsvLines", () => {
  it.each([true, false])(
    "fails instead of hanging when the file can't be read (compressed: %s)",
    async (compressed) => {
      // A directory opens but every read fails (EISDIR).
      const directory = mkdtempSync(join(tmpdir(), "chaturanga-scan-"));
      await expect(scanCsvLines(directory, compressed, () => undefined)).rejects.toThrow(/EISDIR/);
    }
  );

  it("reads every frame of a multi-frame file that starts with a skippable frame (pzstd, Lichess)", async () => {
    // Frames cut mid-line, so a line spans a frame boundary too.
    const text = Buffer.from(CSV);
    const cuts = [0, 1234, 20_000, 33_333, text.length];
    const frames = cuts.slice(1).map((end, i) => zstdCompressSync(text.subarray(cuts[i], end)));
    const path = tempFile(
      "multi.csv.zst",
      Buffer.concat([
        skippableFrame(Buffer.from("pzstd index")),
        frames[0]!,
        skippableFrame(Buffer.alloc(4)),
        ...frames.slice(1)
      ])
    );
    expect(await readLines(path, true)).toEqual(CSV.split("\n"));
  });

  it("stops early without reading the rest", async () => {
    const path = tempFile(
      "one.csv.zst",
      Buffer.concat([
        zstdCompressSync(Buffer.from(CSV.slice(0, 5000))),
        zstdCompressSync(Buffer.from(CSV.slice(5000)))
      ])
    );
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
    const path = tempFile(
      "bad.csv.zst",
      Buffer.concat([zstdCompressSync(Buffer.from("PuzzleId,FEN\n")), corrupt])
    );
    await expect(readLines(path, true)).rejects.toThrow(/Data corruption detected/);
  });
});

/** A small seeded PRNG (mulberry32): the same draws in [0, 1) on every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Draws that come from `values` in order; running out fails the test (an unexpected draw). */
function scripted(values: number[]): () => number {
  const queue = [...values];
  return () => {
    const next = queue.shift();
    if (next === undefined) throw new Error("an unexpected random draw");
    return next;
  };
}

/** A Lichess-format CSV whose rows `p0`… all pass the cheap filters (no filters set). */
function lichessCsv(count: number): string {
  return [
    "PuzzleId,FEN,Moves,Rating",
    ...Array.from({ length: count }, (_, i) => `p${i},fen ${i},e2e4 e7e5,1500`)
  ].join("\n");
}

const scanJob = (filePath: string, size: number, extra: Partial<ScanJob> = {}): ScanJob => ({
  filePath,
  compressed: false,
  kind: "lichess",
  input: {} as never,
  excludeIds: [],
  size,
  ...extra
});

const ids = (rows: string[][]) => rows.map((row) => row[0]);

describe("reservoirScan", () => {
  it("keeps every match in file order while there are no more than it holds, drawing nothing", async () => {
    const path = tempFile("few.csv", lichessCsv(3));
    const result = await reservoirScan(scanJob(path, 5), undefined, scripted([]));
    expect(result).toEqual({ rows: expect.any(Array), matches: 3, complete: true });
    expect(ids(result.rows)).toEqual(["p0", "p1", "p2"]);
  });

  it("puts each later match in the slot its draw picks, or drops it when the slot is past the sample", async () => {
    const path = tempFile("draws.csv", lichessCsv(5));
    // Match 3: slot ⌊0.1·3⌋ = 0 takes p2. Match 4: ⌊0.9·4⌋ = 3, past the 2 kept: p3 is dropped.
    // Match 5: ⌊0.3·5⌋ = 1 takes p4.
    const result = await reservoirScan(scanJob(path, 2), undefined, scripted([0.1, 0.9, 0.3]));
    expect(ids(result.rows)).toEqual(["p2", "p4"]);
    expect(result).toMatchObject({ matches: 5, complete: true });
  });

  it("excluded and filtered-out rows neither count as matches nor take a draw", async () => {
    const csv = [
      "PuzzleId,FEN,Moves,Rating",
      "p0,fen,e2e4 e7e5,1500",
      "gone,fen,e2e4 e7e5,1500",
      "short,fen,e2e4,1500",
      "p1,fen,e2e4 e7e5,1500",
      "p2,fen,e2e4 e7e5,1500"
    ].join("\n");
    const path = tempFile("skips.csv", csv);
    // Only p2 (the third match) draws: ⌊0.5·3⌋ = 1 takes p1's slot.
    const result = await reservoirScan(
      scanJob(path, 2, { excludeIds: ["gone"] }),
      undefined,
      scripted([0.5])
    );
    expect(ids(result.rows)).toEqual(["p0", "p2"]);
    expect(result).toMatchObject({ matches: 3, complete: true });
  });

  it("a quick scan stops at its match limit with an incomplete sample of the file's start", async () => {
    const path = tempFile("quick.csv", lichessCsv(100));
    const result = await reservoirScan(scanJob(path, 4, { maxMatches: 10 }), undefined, seeded(7));
    expect(result).toMatchObject({ matches: 10, complete: false });
    expect(result.rows).toHaveLength(4);
    for (const id of ids(result.rows)) expect(Number(id?.slice(1))).toBeLessThan(10);
  });

  it("a seeded scan keeps the same rows on every run, and gives every row an equal chance", async () => {
    const path = tempFile("uniform.csv", lichessCsv(20));
    const first = await reservoirScan(scanJob(path, 5), undefined, seeded(42));
    const again = await reservoirScan(scanJob(path, 5), undefined, seeded(42));
    expect(ids(again.rows)).toEqual(ids(first.rows));

    // 5 of 20 rows: each is kept a quarter of the time, whether early (in the first fill) or late.
    const random = seeded(2026);
    const kept = new Map<string, number>();
    const trials = 800;
    for (let trial = 0; trial < trials; trial += 1) {
      const { rows } = await reservoirScan(scanJob(path, 5), undefined, random);
      for (const id of ids(rows)) kept.set(id!, (kept.get(id!) ?? 0) + 1);
    }
    expect(kept.size).toBe(20);
    for (const count of kept.values()) expect(Math.abs(count / trials - 0.25)).toBeLessThan(0.06);
  });

  it("a file nothing could be read from is an error, not an empty result", async () => {
    // Only a skippable frame: a valid zstd file with no content.
    const path = tempFile("empty.csv.zst", skippableFrame(Buffer.from("nothing here")));
    await expect(
      reservoirScan({
        filePath: path,
        compressed: true,
        kind: "lichess",
        input: {} as never,
        excludeIds: [],
        size: 10
      })
    ).rejects.toThrow(/No lines could be read/);
  });

  it("keeps only the puzzles asked for by id, and stops once it has all of them", async () => {
    const path = tempFile("ids.csv", CSV);
    const job = (ids: string[]): ScanJob => ({
      filePath: path,
      compressed: false,
      kind: "lichess",
      input: { databaseId: "db", ids },
      excludeIds: [],
      size: 10
    });
    const found = await reservoirScan(job(["p1999", "p5", "missing"]));
    expect(found.rows.map((row) => row[0]).sort()).toEqual(["p1999", "p5"]);
    expect(found).toMatchObject({ matches: 2, complete: true });
    // Both found near the start: the rest of the file isn't needed, and the scan is still complete.
    let cancelChecks = 0;
    const early = await reservoirScan(job(["p0", "p2"]), () => {
      cancelChecks += 1;
      return false;
    });
    expect(early).toMatchObject({ matches: 2, complete: true });
    expect(cancelChecks).toBe(1); // after the first match only
  });

  it("matches nothing for an empty id list (not every puzzle)", async () => {
    const path = tempFile("no-ids.csv", CSV);
    await expect(
      reservoirScan({
        filePath: path,
        compressed: false,
        kind: "lichess",
        input: { databaseId: "db", ids: [] },
        excludeIds: [],
        size: 10
      })
    ).resolves.toEqual({ rows: [], matches: 0, complete: true });
  });
});

describe("readFirstLine", () => {
  it("reads only the start of a large file", async () => {
    const path = tempFile("lines.csv.zst", zstdCompressSync(Buffer.from(CSV)));
    expect(await readFirstLine(path, true)).toBe("PuzzleId,FEN,Moves,Rating");
  });

  it("gives up on text with no line break", async () => {
    const path = tempFile("blob.csv", "x".repeat(200_000));
    expect(await readFirstLine(path, false)).toBeNull();
  });
});

describe("workerScanner", () => {
  const job = {
    filePath: "unused",
    compressed: false,
    kind: "lichess",
    input: {} as never,
    excludeIds: [],
    size: 1
  } satisfies ScanJob;
  const worker = (source: string) => tempFile("worker.mjs", source);

  it("resolves with the answer the worker posts before it exits", async () => {
    const path = worker(
      'import { parentPort, workerData } from "node:worker_threads";\n' +
        "parentPort.postMessage({ ok: true, result: { rows: [[workerData.filePath]], matches: 1, complete: true } });"
    );
    await expect(workerScanner(path)(job).result).resolves.toEqual({
      rows: [["unused"]],
      matches: 1,
      complete: true
    });
  });

  it("rejects a failed scan as a file error, not a worker failure", async () => {
    const path = worker(
      'import { parentPort } from "node:worker_threads";\nparentPort.postMessage({ ok: false, message: "corrupt block" });'
    );
    const failure = await workerScanner(path)(job).result.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ScanWorkerError);
    expect((failure as Error).message).toBe("corrupt block");
  });

  it.each([
    ["crashes", 'throw new Error("boom");', /crashed \(boom\)/],
    ["exits without an answer", "", /without an answer \(exit code 0\)/],
    ["exits with an error code", "process.exit(3);", /without an answer \(exit code 3\)/]
  ])("rejects when the worker %s", async (_, source, message) => {
    const failure = await workerScanner(worker(source))(job).result.catch(
      (error: unknown) => error
    );
    expect(failure).toBeInstanceOf(ScanWorkerError);
    expect((failure as Error).message).toMatch(message);
  });

  it("rejects when the worker file is missing", async () => {
    await expect(
      workerScanner(join(tmpdir(), "no-such-puzzle-worker.js"))(job).result
    ).rejects.toThrow(ScanWorkerError);
  });

  it("rejects a stuck worker after the timeout, and a cancelled one at once", async () => {
    const stuck = worker("setInterval(() => undefined, 1000);");
    await expect(workerScanner(stuck, 50)(job).result).rejects.toThrow(/stopped responding/);
    const scan = workerScanner(stuck)(job);
    scan.cancel();
    await expect(scan.result).rejects.toThrow(ScanCancelledError);
  });
});
