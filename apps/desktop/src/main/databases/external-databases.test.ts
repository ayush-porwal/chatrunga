import { mkdtempSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const userData = mkdtempSync(join(tmpdir(), "chaturanga-databases-"));
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

const rows = new Map<string, { id: string; sourceId: string; filePath: string }>();
vi.mock("../db/repositories", () => ({
  externalDatabaseRepository: {
    getBySource: (sourceId: string) => rows.get(sourceId) ?? null,
    saveDownloaded: (input: { source: { id: string }; filePath: string }) => {
      const row = { id: input.source.id, sourceId: input.source.id, filePath: input.filePath };
      rows.set(input.source.id, row);
      return row;
    }
  }
}));

import { downloadDatabase } from "./external-databases";

const SOURCE = "lichess-puzzles";
const dir = join(userData, "databases");
const finalPath = join(dir, "lichess-puzzles-lichess_db_puzzle.csv.zst");

/** A server for one file with ETag, Range and If-Range, like database.lichess.org. */
function fakeServer(content: Buffer, etag: string, options: { failAfter?: number } = {}) {
  const requests: Array<Record<string, string>> = [];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    requests.push(headers);
    const range = /^bytes=(\d+)-$/.exec(headers.Range ?? "");
    const rangeApplies = range && (!headers["If-Range"] || headers["If-Range"] === etag);
    if (range && rangeApplies && Number(range[1]) >= content.length) return new Response(null, { status: 416 });
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
      headers: { "content-length": String(body.length), etag }
    });
  });
  return { fetchMock, requests };
}

const content = Buffer.from("PuzzleId,FEN,Moves\n".repeat(500));

beforeEach(async () => {
  rows.clear();
  await rm(dir, { recursive: true, force: true });
});

afterEach(() => vi.unstubAllGlobals());

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

  it("adopts a complete file an older build left without a row", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(finalPath, content);
    const server = fakeServer(content, '"v1"');
    vi.stubGlobal("fetch", server.fetchMock);
    await downloadDatabase(SOURCE, () => undefined);
    expect(server.requests).toEqual([{ Range: `bytes=${content.length}-` }]);
    expect(await readFile(finalPath)).toEqual(content);
    expect(rows.has(SOURCE)).toBe(true);
  });

  it("restarts a partial file an older build left, since its version is unknown", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(finalPath, content.subarray(0, 1000));
    const server = fakeServer(content, '"v1"');
    vi.stubGlobal("fetch", server.fetchMock);
    await downloadDatabase(SOURCE, () => undefined);
    expect(server.requests).toEqual([{ Range: "bytes=1000-" }, {}]);
    expect(await readFile(finalPath)).toEqual(content);
  });
});
