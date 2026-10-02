import { mkdtempSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const userData = mkdtempSync(join(tmpdir(), "chaturanga-databases-"));
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

type Row = { id: string; sourceId: string; filePath: string; name?: string; format?: string };
const rows = new Map<string, Row>();
const repository = vi.hoisted(() => ({ failSave: false }));
vi.mock("../db/repositories", () => ({
  externalDatabaseRepository: {
    list: () => [...rows.values()],
    updateFilePath: (id: string, filePath: string) => {
      for (const row of rows.values()) if (row.id === id) row.filePath = filePath;
    },
    get: (id: string) => [...rows.values()].find((row) => row.id === id) ?? null,
    getBySource: (sourceId: string) => rows.get(sourceId) ?? null,
    remove: (id: string) => {
      for (const [key, row] of rows) if (row.id === id) rows.delete(key);
    },
    saveDownloaded: (input: { source: { id: string }; filePath: string }) => {
      if (repository.failSave) throw new Error("disk full");
      const row = { id: input.source.id, sourceId: input.source.id, filePath: input.filePath };
      rows.set(input.source.id, row);
      return row;
    }
  }
}));

/** Counts the scans of the whole file (no match limit), and can make them fail like a corrupt file. */
const fullScans = vi.hoisted(() => ({ count: 0, fail: false }));
vi.mock("./puzzle-scan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./puzzle-scan")>();
  return {
    ...actual,
    reservoirScan: (job: import("./puzzle-scan").ScanJob, isCancelled?: () => boolean) => {
      if (job.maxMatches !== undefined) return actual.reservoirScan(job, isCancelled);
      fullScans.count += 1;
      return fullScans.fail ? Promise.reject(new Error("corrupt block")) : actual.reservoirScan(job, isCancelled);
    }
  };
});

import { zstdCompressSync } from "node:zlib";
import type { DatabaseDownloadProgress, PuzzleSampleInput } from "@chaturanga/shared/types/database";
import { logger } from "../logger";
import {
  cancelAllDownloads,
  cancelDownload,
  downloadDatabase,
  listInstalledDatabases,
  removeDatabase,
  samplePuzzle
} from "./external-databases";

const SOURCE = "lichess-puzzles";
const dir = join(userData, "puzzle-databases");
const finalPath = join(dir, "lichess-puzzles-lichess_db_puzzle.csv.zst");

/** A server for one file with ETag, Range and If-Range, like database.lichess.org. */
function fakeServer(content: Buffer, etag: string, options: { failAfter?: number } = {}) {
  const requests: Array<Record<string, string>> = [];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const { "Accept-Encoding": encoding, ...headers } = (init?.headers ?? {}) as Record<string, string>;
    expect(encoding).toBe("identity");
    requests.push(headers);
    const range = /^bytes=(\d+)-$/.exec(headers.Range ?? "");
    const rangeApplies = range && (!headers["If-Range"] || headers["If-Range"] === etag);
    if (range && rangeApplies && Number(range[1]) >= content.length) {
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${content.length}` } });
    }
    const start = range && rangeApplies ? Number(range[1]) : 0;
    const body = content.subarray(start);
    const failAfter = options.failAfter;
    options.failAfter = undefined; // only the first transfer breaks
    let sent = false;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(new Uint8Array(failAfter === undefined ? body : body.subarray(0, failAfter)));
          if (failAfter === undefined) controller.close();
          return;
        }
        // The connection drops a little later, after the first chunk reached the disk.
        await new Promise((resolve) => setTimeout(resolve, 20));
        controller.error(new Error("connection reset"));
      }
    });
    return new Response(stream, {
      status: start ? 206 : 200,
      headers: {
        "content-length": String(body.length),
        etag,
        ...(start ? { "content-range": `bytes ${start}-${content.length - 1}/${content.length}` } : {})
      }
    });
  });
  return { fetchMock, requests };
}

const content = Buffer.from("PuzzleId,FEN,Moves\n".repeat(500));

beforeEach(async () => {
  rows.clear();
  repository.failSave = false;
  fullScans.count = 0;
  fullScans.fail = false;
  await rm(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("downloadDatabase", () => {
  it("downloads to a .part file and renames it into place when complete", async () => {
    vi.stubGlobal("fetch", fakeServer(content, '"v1"').fetchMock);
    await downloadDatabase(SOURCE, () => undefined);
    expect(await readFile(finalPath)).toEqual(content);
    expect(await readdir(dir)).toEqual(["lichess-puzzles-lichess_db_puzzle.csv.zst"]);
    expect(rows.get(SOURCE)?.filePath).toBe(finalPath);
  });

  it("resumes an interrupted download from where it stopped", async () => {
    const server = fakeServer(content, '"v1"', { failAfter: 3000 });
    vi.stubGlobal("fetch", server.fetchMock);
    await expect(downloadDatabase(SOURCE, () => undefined)).rejects.toThrow("connection reset");
    expect(rows.has(SOURCE)).toBe(false);

    await downloadDatabase(SOURCE, () => undefined);
    expect(server.requests[1]).toEqual({ Range: "bytes=3000-", "If-Range": '"v1"' });
    expect(await readFile(finalPath)).toEqual(content);
    expect(rows.has(SOURCE)).toBe(true);
  });

  it("starts over when the file changed upstream since the interruption", async () => {
    vi.stubGlobal("fetch", fakeServer(content, '"v1"', { failAfter: 3000 }).fetchMock);
    await expect(downloadDatabase(SOURCE, () => undefined)).rejects.toThrow();
    const updated = Buffer.from("PuzzleId,FEN,Moves,Rating\n".repeat(400));
    vi.stubGlobal("fetch", fakeServer(updated, '"v2"').fetchMock);
    await downloadDatabase(SOURCE, () => undefined);
    expect(await readFile(finalPath)).toEqual(updated);
  });

  it("finishes a partial the server confirms is already complete", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(`${finalPath}.part`, content);
    await writeFile(`${finalPath}.part.validator`, '"v1"');
    const server = fakeServer(content, '"v1"');
    vi.stubGlobal("fetch", server.fetchMock);
    await downloadDatabase(SOURCE, () => undefined);
    expect(server.requests).toEqual([{ Range: `bytes=${content.length}-`, "If-Range": '"v1"' }]);
    expect(await readFile(finalPath)).toEqual(content);
    expect(await readdir(dir)).toEqual(["lichess-puzzles-lichess_db_puzzle.csv.zst"]);
  });

  it("starts over when a partial is longer than the server's file", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(`${finalPath}.part`, Buffer.concat([content, Buffer.from("stale tail")]));
    await writeFile(`${finalPath}.part.validator`, '"v1"');
    const server = fakeServer(content, '"v1"');
    vi.stubGlobal("fetch", server.fetchMock);
    await downloadDatabase(SOURCE, () => undefined);
    expect(server.requests).toEqual([{ Range: `bytes=${content.length + 10}-`, "If-Range": '"v1"' }, {}]);
    expect(await readFile(finalPath)).toEqual(content);
  });

  it("never continues a partial whose version wasn't recorded", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(`${finalPath}.part`, content.subarray(0, 1000));
    const server = fakeServer(content, '"v1"');
    vi.stubGlobal("fetch", server.fetchMock);
    await downloadDatabase(SOURCE, () => undefined);
    expect(server.requests).toEqual([{}]);
    expect(await readFile(finalPath)).toEqual(content);
  });

  it("resumes a refresh of an installed database too", async () => {
    rows.set(SOURCE, { id: SOURCE, sourceId: SOURCE, filePath: finalPath });
    const server = fakeServer(content, '"v1"', { failAfter: 2000 });
    vi.stubGlobal("fetch", server.fetchMock);
    await expect(downloadDatabase(SOURCE, () => undefined)).rejects.toThrow();
    await downloadDatabase(SOURCE, () => undefined);
    expect(server.requests[1]).toEqual({ Range: "bytes=2000-", "If-Range": '"v1"' });
    expect(await readFile(finalPath)).toEqual(content);
  });

  it("joins a second request for a database that is already downloading", async () => {
    const server = fakeServer(content, '"v1"');
    vi.stubGlobal("fetch", server.fetchMock);
    const [first, second] = await Promise.all([downloadDatabase(SOURCE, () => undefined), downloadDatabase(SOURCE, () => undefined)]);
    expect(first).toBe(second);
    expect(server.requests).toHaveLength(1);
    expect(await readFile(finalPath)).toEqual(content);
  });
});

describe("download reliability", () => {
  it("announces completion only after the database is registered", async () => {
    repository.failSave = true;
    vi.stubGlobal("fetch", fakeServer(content, '"v1"').fetchMock);
    const events: DatabaseDownloadProgress[] = [];
    await expect(downloadDatabase(SOURCE, (progress) => events.push(progress))).rejects.toThrow("disk full");
    expect(events.map((event) => event.state)).not.toContain("completed");
    expect(events.at(-1)?.state).toBe("failed");
  });

  it("can be cancelled, keeping the partial file for a resume", async () => {
    vi.stubGlobal("fetch", fakeServer(content, '"v1"', { failAfter: 3000 }).fetchMock);
    const events: DatabaseDownloadProgress[] = [];
    const download = downloadDatabase(SOURCE, (progress) => events.push(progress));
    setTimeout(() => cancelDownload(SOURCE), 5);
    await expect(download).rejects.toThrow("Download cancelled.");
    expect(events.at(-1)?.state).toBe("cancelled");
    expect(await readdir(dir)).toContain("lichess-puzzles-lichess_db_puzzle.csv.zst.part");
  });

  it("quitting waits for a cancelled download to settle", async () => {
    // Sends the first part of the file, then nothing more until cancelled.
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => controller.enqueue(new Uint8Array(content.subarray(0, 3000))),
      pull: () => new Promise(() => undefined)
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, { headers: { "content-length": String(content.length), etag: '"v1"' } })));
    const events: DatabaseDownloadProgress[] = [];
    const download = downloadDatabase(SOURCE, (progress) => events.push(progress)).catch(() => undefined);
    await vi.waitFor(() => expect(events.some((event) => event.downloadedBytes > 0)).toBe(true), { interval: 1 });
    await cancelAllDownloads();
    // Settled before the database closes: nothing is registered or reported after this.
    expect(events.at(-1)?.state).toBe("cancelled");
    expect(rows.has(SOURCE)).toBe(false);
    await download;
  });

  it("starts over when a resumed response doesn't continue where the partial ends", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(`${finalPath}.part`, content.subarray(0, 1000));
    await writeFile(`${finalPath}.part.validator`, '"v1"');
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        calls += 1;
        const headers = (init?.headers ?? {}) as Record<string, string>;
        if (headers.Range) {
          // Claims to resume, but from the wrong byte.
          return new Response(content.subarray(500), {
            status: 206,
            headers: { "content-length": String(content.length - 500), "content-range": `bytes 500-${content.length - 1}/${content.length}` }
          });
        }
        return new Response(content, { status: 200, headers: { "content-length": String(content.length), etag: '"v1"' } });
      })
    );
    await downloadDatabase(SOURCE, () => undefined);
    expect(calls).toBe(2);
    expect(await readFile(finalPath)).toEqual(content);
  });
});

describe("resume without Content-Length", () => {
  it("uses the size in Content-Range, so a short transfer isn't installed", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(`${finalPath}.part`, content.subarray(0, 1000));
    await writeFile(`${finalPath}.part.validator`, '"v1"');
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        // Claims the rest of the file but sends only part of it, with no Content-Length.
        new Response(content.subarray(1000, 2000), {
          status: 206,
          headers: { "content-range": `bytes 1000-${content.length - 1}/${content.length}` }
        })
      )
    );
    await expect(downloadDatabase(SOURCE, () => undefined)).rejects.toThrow(/ended early/);
    expect(rows.has(SOURCE)).toBe(false);
  });
});

describe("removeDatabase", () => {
  it("deletes the file and any partial download, then the entry", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(finalPath, content);
    await writeFile(`${finalPath}.part`, "x");
    rows.set(SOURCE, { id: "db", sourceId: SOURCE, filePath: finalPath });
    await removeDatabase("db");
    expect(await readdir(dir)).toEqual([]);
    expect(rows.size).toBe(0);
  });

  it("finishes before a new download of the same database starts", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(finalPath, content);
    rows.set(SOURCE, { id: "db", sourceId: SOURCE, filePath: finalPath });
    // A refresh that sends part of the file, then nothing more until cancelled.
    const stalled = new ReadableStream<Uint8Array>({
      start: (controller) => controller.enqueue(new Uint8Array(content.subarray(0, 3000))),
      pull: () => new Promise(() => undefined)
    });
    const seenBySecond: Array<{ installed: boolean; files: string[] }> = [];
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return new Response(stalled, { headers: { "content-length": String(content.length), etag: '"v1"' } });
      }
      seenBySecond.push({ installed: rows.has(SOURCE), files: await readdir(dir) });
      return new Response(content, { headers: { "content-length": String(content.length), etag: '"v2"' } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const events: DatabaseDownloadProgress[] = [];
    const refresh = downloadDatabase(SOURCE, (progress) => events.push(progress)).catch(() => undefined);
    await vi.waitFor(() => expect(events.some((event) => event.downloadedBytes > 0)).toBe(true), { interval: 1 });

    const removal = removeDatabase("db");
    // Asked for again the moment the cancelled refresh settles, while its files are being deleted.
    const again = refresh.then(() => downloadDatabase(SOURCE, () => undefined));
    await removal;
    await again;
    // The new download ran only after the removal was done, and nothing of it was deleted.
    expect(seenBySecond).toEqual([{ installed: false, files: [] }]);
    expect(await readFile(finalPath)).toEqual(content);
    expect(rows.get(SOURCE)?.filePath).toBe(finalPath);
  });

  it("keeps the entry when the file can't be deleted", async () => {
    // A directory where the file should be: unlink fails with EISDIR/EPERM, not ENOENT.
    await mkdir(finalPath, { recursive: true });
    rows.set(SOURCE, { id: "db", sourceId: SOURCE, filePath: finalPath });
    await expect(removeDatabase("db")).rejects.toThrow();
    expect(rows.size).toBe(1);
  });
});

describe("samplePuzzle", () => {
  const header = "PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags";
  // White to move before the opponent's (White's) e2e4; Black solves with e7e5.
  const row = (id: string, rating: number) =>
    `${id},rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1,e2e4 e7e5,${rating},80,90,100,short opening,,`;
  const input = (overrides: Partial<NonNullable<PuzzleSampleInput["lichess"]>> = {}): PuzzleSampleInput => ({
    databaseId: "puzzles",
    lichess: { ratingMin: 0, ratingMax: 3000, popularityMin: 0, lengths: [], themes: [], openings: [], side: "any", ...overrides }
  });

  async function install(lines: string[]) {
    await mkdir(dir, { recursive: true });
    const file = join(dir, "puzzles.csv.zst");
    await writeFile(file, zstdCompressSync(Buffer.from([header, ...lines].join("\n"))));
    rows.set(SOURCE, { id: "puzzles", sourceId: SOURCE, filePath: file, name: "Puzzles", format: "csv.zst" });
  }

  it("reaches puzzles past the file's first matches once the whole-file pool is filled", async () => {
    await install(Array.from({ length: 3000 }, (_, index) => row(`p${index}`, 1500)));
    await samplePuzzle(input());
    const seen = new Set<number>();
    await vi.waitFor(async () => {
      const sample = await samplePuzzle(input());
      seen.add(Number(sample.id.slice(1)));
      expect([...seen].some((index) => index >= 500)).toBe(true);
    }, { timeout: 5_000, interval: 1 });
  });

  it("serves a small match set again to a new session instead of reporting no match", async () => {
    await install([row("a", 2500), row("b", 2500)]);
    const filters = input({ ratingMin: 2000 });
    const first = await samplePuzzle(filters);
    await new Promise((resolve) => setTimeout(resolve, 200)); // the full scan fills the pool
    const second = await samplePuzzle({ ...filters, excludeIds: [first.id] });
    expect(second.id).not.toBe(first.id);
    await expect(samplePuzzle({ ...filters, excludeIds: ["a", "b"] })).rejects.toThrow(/No puzzle matched/);
    // A new session (nothing excluded) still gets puzzles.
    expect(["a", "b"]).toContain((await samplePuzzle(filters)).id);
  });

  it("reuses a quick scan that read the whole file instead of scanning it again", async () => {
    await install([row("a", 2500), row("b", 2500), row("low", 800)]);
    const filters = input({ ratingMin: 2000 });
    const first = await samplePuzzle(filters);
    expect(["a", "b"]).toContain((await samplePuzzle({ ...filters, excludeIds: [first.id] })).id);
    // No match at all: answered from the first scan from then on.
    await expect(samplePuzzle(input({ ratingMin: 2900 }))).rejects.toThrow(/No puzzle matched/);
    await expect(samplePuzzle(input({ ratingMin: 2900 }))).rejects.toThrow(/No puzzle matched/);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fullScans.count).toBe(0);
  });

  it("logs a failed whole-file scan once and keeps serving from the quick scan", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    fullScans.fail = true;
    await install(Array.from({ length: 1000 }, (_, index) => row(`p${index}`, 1500)));
    await samplePuzzle(input());
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(String(warn.mock.calls[0])).toMatch(/corrupt block/);
    await samplePuzzle(input());
    await samplePuzzle(input());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fullScans.count).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("skips a malformed row instead of reporting no match", async () => {
    const broken = "bad,not-a-fen,e2e4 e7e5,1500,80,90,100,short,,";
    await install([broken, broken, broken, row("good", 1500)]);
    expect((await samplePuzzle(input())).id).toBe("good");
  });

  it("doesn't let rows too short to make a puzzle fill the sample", async () => {
    // More one-move rows than a quick scan keeps, all before the only real puzzle.
    const oneMove = (id: string) => `${id},rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1,e2e4,1500,80,90,100,short,,`;
    await install([...Array.from({ length: 600 }, (_, index) => oneMove(`short${index}`)), row("good", 1500)]);
    expect((await samplePuzzle(input())).id).toBe("good");
  });

  it("applies the filters and the excluded ids", async () => {
    await install([row("low", 800), row("high", 2500), row("done", 2500)]);
    const sample = await samplePuzzle({ ...input({ ratingMin: 2000 }), excludeIds: ["done"] });
    expect(sample.id).toBe("high");
    expect(sample.sideToMove).toBe("black");
    await expect(samplePuzzle({ ...input({ ratingMin: 2000 }), excludeIds: ["done", "high"] })).rejects.toThrow(/No puzzle matched/);
  });
});

describe("entries registered in the old folder", () => {
  const legacyPath = join(userData, "databases", "lichess-puzzles-lichess_db_puzzle.csv.zst");

  it("follow their moved file when listed", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(finalPath, content);
    rows.set(SOURCE, { id: "db", sourceId: SOURCE, filePath: legacyPath });
    const listed = await listInstalledDatabases();
    expect(listed.map((database) => database.filePath)).toEqual([finalPath]);
    expect(rows.get(SOURCE)?.filePath).toBe(finalPath);
  });

  it("are dropped when the file is gone from both places", async () => {
    rows.set(SOURCE, { id: "db", sourceId: SOURCE, filePath: legacyPath });
    expect(await listInstalledDatabases()).toEqual([]);
    expect(rows.size).toBe(0);
  });

  it("follow their moved file when sampled", async () => {
    await mkdir(dir, { recursive: true });
    const header = "PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags";
    const puzzle = "p1,rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1,e2e4 e7e5,1500,80,90,100,short,,";
    await writeFile(join(dir, "lichess-puzzles-lichess_db_puzzle.csv"), [header, puzzle].join("\n"));
    rows.set(SOURCE, {
      id: "db",
      sourceId: SOURCE,
      name: "Puzzles",
      filePath: join(userData, "databases", "lichess-puzzles-lichess_db_puzzle.csv"),
      format: "csv"
    });
    expect((await samplePuzzle({ databaseId: "db" })).id).toBe("p1");
    expect(rows.get(SOURCE)?.filePath).toBe(join(dir, "lichess-puzzles-lichess_db_puzzle.csv"));
  });
});
