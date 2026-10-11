import { statSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseDownloadProgress } from "@chaturanga/shared/types/database";

const fakes = await vi.hoisted(async () => import("./__fixtures__/database-fakes"));
vi.mock("electron", () => ({ app: { getPath: () => fakes.userData } }));
vi.mock("../db/external-database-repository", () => ({
  externalDatabaseRepository: fakes.externalDatabaseRepository
}));
vi.mock("./puzzle-scan", async (importOriginal) =>
  fakes.countingFullScans(await importOriginal<typeof import("./puzzle-scan")>())
);
vi.mock("node:fs/promises", async (importOriginal) =>
  fakes.withRenameHook(await importOriginal<typeof import("node:fs/promises")>())
);

import { cancelDownload, downloadDatabase, removeDatabase } from "./external-databases";
import { listInstalledDatabases } from "./installed-databases";
import { samplePuzzle, setPuzzleScanner } from "./puzzle-sampling";
import {
  dir,
  finalPath,
  inThreadScanner,
  LICHESS_HEADER,
  releaseGatedScans,
  resetDatabaseFakes,
  SOURCE
} from "./__fixtures__/puzzle-files";

const { fsHooks, repository, rows, userData } = fakes;

/** A server for one file with ETag, Range and If-Range, like database.lichess.org. */
function fakeServer(content: Buffer, etag: string, options: { failAfter?: number } = {}) {
  const requests: Array<Partial<Record<string, string>>> = [];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const { "Accept-Encoding": encoding, ...headers } = (init?.headers ?? {}) as Partial<
      Record<string, string>
    >;
    expect(encoding).toBe("identity");
    requests.push(headers);
    const range = /^bytes=(\d+)-$/.exec(headers.Range ?? "");
    const rangeApplies = range && (!headers["If-Range"] || headers["If-Range"] === etag);
    if (range && rangeApplies && Number(range[1]) >= content.length) {
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${content.length}` }
      });
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
          controller.enqueue(
            new Uint8Array(failAfter === undefined ? body : body.subarray(0, failAfter))
          );
          if (failAfter === undefined) controller.close();
          return;
        }
        // The connection drops once the first chunk reached the disk.
        await vi.waitFor(
          () =>
            expect(statSync(`${finalPath}.part`, { throwIfNoEntry: false })?.size).toBe(failAfter),
          {
            interval: 1
          }
        );
        controller.error(new Error("connection reset"));
      }
    });
    return new Response(stream, {
      status: start ? 206 : 200,
      headers: {
        "content-length": String(body.length),
        etag,
        ...(start
          ? { "content-range": `bytes ${start}-${content.length - 1}/${content.length}` }
          : {})
      }
    });
  });
  return { fetchMock, requests };
}

/** A valid compressed puzzle file; random ids keep it from compressing to a few bytes. */
function dataset(rowCount: number): Buffer<ArrayBuffer> {
  const rows = Array.from(
    { length: rowCount },
    (_, index) =>
      `${randomBytes(8).toString("hex")},fen,e2e4 e7e5,${1000 + index},80,90,100,short,,`
  );
  return zstdCompressSync(Buffer.from([LICHESS_HEADER, ...rows].join("\n")));
}
const content = dataset(800);

/** A module instance of its own, for tests that quit (which leaves the module refusing downloads). */
async function freshModule() {
  vi.resetModules();
  return import("./external-databases");
}

beforeEach(async () => {
  await resetDatabaseFakes();
  setPuzzleScanner(inThreadScanner);
});

afterEach(() => {
  releaseGatedScans();
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
    await expect(downloadDatabase(SOURCE, () => undefined)).rejects.toThrow(/connection reset/);
    const updated = dataset(400);
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
    expect(server.requests).toEqual([
      { Range: `bytes=${content.length + 10}-`, "If-Range": '"v1"' },
      {}
    ]);
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
    await expect(downloadDatabase(SOURCE, () => undefined)).rejects.toThrow(/connection reset/);
    await downloadDatabase(SOURCE, () => undefined);
    expect(server.requests[1]).toEqual({ Range: "bytes=2000-", "If-Range": '"v1"' });
    expect(await readFile(finalPath)).toEqual(content);
  });

  it("joins a second request for a database that is already downloading", async () => {
    const server = fakeServer(content, '"v1"');
    vi.stubGlobal("fetch", server.fetchMock);
    const [first, second] = await Promise.all([
      downloadDatabase(SOURCE, () => undefined),
      downloadDatabase(SOURCE, () => undefined)
    ]);
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
    await expect(downloadDatabase(SOURCE, (progress) => events.push(progress))).rejects.toThrow(
      "disk full"
    );
    expect(events.map((event) => event.state)).not.toContain("completed");
    expect(events.at(-1)?.state).toBe("failed");
  });

  it("can be cancelled, keeping the partial file for a resume", async () => {
    // Sends the first part of the file, then nothing more until cancelled.
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => controller.enqueue(new Uint8Array(content.subarray(0, 3000))),
      pull: () => new Promise(() => undefined)
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(stream, {
            headers: { "content-length": String(content.length), etag: '"v1"' }
          })
      )
    );
    const events: DatabaseDownloadProgress[] = [];
    const download = downloadDatabase(SOURCE, (progress) => events.push(progress));
    await vi.waitFor(() => expect(events.some((event) => event.downloadedBytes > 0)).toBe(true), {
      interval: 1
    });
    cancelDownload(SOURCE);
    await expect(download).rejects.toThrow("Download cancelled.");
    expect(events.at(-1)?.state).toBe("cancelled");
    expect(await readdir(dir)).toContain("lichess-puzzles-lichess_db_puzzle.csv.zst.part");
  });

  it("quitting waits for a cancelled download to settle", async () => {
    const { cancelAllDownloads, downloadDatabase } = await freshModule();
    // Sends the first part of the file, then nothing more until cancelled.
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => controller.enqueue(new Uint8Array(content.subarray(0, 3000))),
      pull: () => new Promise(() => undefined)
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(stream, {
            headers: { "content-length": String(content.length), etag: '"v1"' }
          })
      )
    );
    const events: DatabaseDownloadProgress[] = [];
    const download = downloadDatabase(SOURCE, (progress) => events.push(progress)).catch(
      () => undefined
    );
    await vi.waitFor(() => expect(events.some((event) => event.downloadedBytes > 0)).toBe(true), {
      interval: 1
    });
    await cancelAllDownloads();
    // Settled before the database closes: nothing is registered or reported after this.
    expect(events.at(-1)?.state).toBe("cancelled");
    expect(rows.has(SOURCE)).toBe(false);
    await download;
  });

  it("Cancel pressed while the finished file is put in place installs nothing", async () => {
    vi.stubGlobal("fetch", fakeServer(content, '"v1"').fetchMock);
    let release: () => void = () => undefined;
    const renaming = new Promise<void>((resolve) => {
      fsHooks.beforeRename = () => {
        fsHooks.beforeRename = null; // only the rename that puts the file in place
        resolve();
        return new Promise((done) => (release = done));
      };
    });
    const events: DatabaseDownloadProgress[] = [];
    const download = downloadDatabase(SOURCE, (progress) => events.push(progress));
    download.catch(() => undefined);
    await renaming;
    cancelDownload(SOURCE);
    release();
    await expect(download).rejects.toThrow("Download cancelled.");
    expect(rows.has(SOURCE)).toBe(false);
    expect(events.map((event) => event.state)).not.toContain("completed");
    // The complete file went back to `.part` with its version, so Download again finishes at once.
    expect(await readdir(dir)).toEqual([
      "lichess-puzzles-lichess_db_puzzle.csv.zst.part",
      "lichess-puzzles-lichess_db_puzzle.csv.zst.part.validator"
    ]);
    const server = fakeServer(content, '"v1"');
    vi.stubGlobal("fetch", server.fetchMock);
    await downloadDatabase(SOURCE, () => undefined);
    expect(server.requests).toEqual([{ Range: `bytes=${content.length}-`, "If-Range": '"v1"' }]);
    expect(await readFile(finalPath)).toEqual(content);
  });

  it("a download that finishes after quitting stopped waiting registers nothing", async () => {
    const { cancelAllDownloads, downloadDatabase } = await freshModule();
    vi.stubGlobal("fetch", fakeServer(content, '"v1"').fetchMock);
    let release: () => void = () => undefined;
    const renaming = new Promise<void>((resolve) => {
      fsHooks.beforeRename = () => {
        fsHooks.beforeRename = null; // only the rename that puts the file in place
        resolve();
        return new Promise((done) => (release = done));
      };
    });
    const events: DatabaseDownloadProgress[] = [];
    const download = downloadDatabase(SOURCE, (progress) => events.push(progress));
    download.catch(() => undefined);
    await renaming;
    await cancelAllDownloads(10); // gives up on the download stuck in its rename
    release();
    await expect(download).rejects.toThrow("Download cancelled.");
    // The database is closed by now: nothing registered, nothing announced as installed.
    expect(rows.has(SOURCE)).toBe(false);
    expect(events.map((event) => event.state)).not.toContain("completed");
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
            headers: {
              "content-length": String(content.length - 500),
              "content-range": `bytes 500-${content.length - 1}/${content.length}`
            }
          });
        }
        return new Response(content, {
          status: 200,
          headers: { "content-length": String(content.length), etag: '"v1"' }
        });
      })
    );
    await downloadDatabase(SOURCE, () => undefined);
    expect(calls).toBe(2);
    expect(await readFile(finalPath)).toEqual(content);
  });
});

describe("installing a downloaded file", () => {
  const oldContent = dataset(300);

  async function installOld() {
    await mkdir(dir, { recursive: true });
    await writeFile(finalPath, oldContent);
    rows.set(SOURCE, {
      id: SOURCE,
      sourceId: SOURCE,
      filePath: finalPath,
      fileSizeBytes: oldContent.length
    });
  }

  function serve(body: Buffer | string, contentType = "application/octet-stream") {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(typeof body === "string" ? body : new Uint8Array(body), {
            headers: {
              "content-length": String(Buffer.byteLength(body)),
              "content-type": contentType,
              etag: '"v2"'
            }
          })
      )
    );
  }

  async function expectRejected(pattern: RegExp) {
    const events: DatabaseDownloadProgress[] = [];
    await expect(downloadDatabase(SOURCE, (progress) => events.push(progress))).rejects.toThrow(
      pattern
    );
    expect(events.map((event) => event.state)).not.toContain("completed");
    expect(events.at(-1)).toMatchObject({
      state: "failed",
      message: expect.stringMatching(/isn't a valid dataset/)
    });
    // The previous installation is untouched, and the bad bytes aren't kept for a resume.
    expect(await readFile(finalPath)).toEqual(oldContent);
    expect(rows.get(SOURCE)?.filePath).toBe(finalPath);
    expect(await readdir(dir)).toEqual(["lichess-puzzles-lichess_db_puzzle.csv.zst"]);
  }

  it("rejects a web page served as text/html", async () => {
    await installOld();
    serve("<!doctype html><title>Sign in</title>", "text/html; charset=utf-8");
    await expectRejected(/web page/);
  });

  it("rejects a web page served with a misleading content type", async () => {
    await installOld();
    serve("\n  <html><body>Not found</body></html>");
    await expectRejected(/web page/);
  });

  it("rejects a file that isn't zstd", async () => {
    await installOld();
    const bytes = randomBytes(5000);
    // A leading "<" (or whitespace then "<") would read as a web page instead: about 1 run in 200.
    bytes[0] = 0;
    serve(bytes);
    await expectRejected(/isn't zstd-compressed/);
  });

  it("rejects a corrupt zstd stream", async () => {
    await installOld();
    const corrupt = Buffer.from(content);
    corrupt.fill(0x41, 8, 200);
    serve(corrupt);
    await expectRejected(/couldn't be read|damaged|unexpected data|ends in the middle/);
  });

  /** A good first frame (the header and some rows) followed by `rest`, as pzstd writes many frames. */
  const framesAfterGoodStart = (rest: Buffer) => Buffer.concat([content, rest]);
  const laterFrame = () =>
    zstdCompressSync(
      Buffer.from(
        Array.from(
          { length: 800 },
          () => `${randomBytes(8).toString("hex")},fen,e2e4,1500,80,90,100,short,,`
        ).join("\n")
      )
    );

  it("rejects a file whose later frame is cut short, though it starts well", async () => {
    await installOld();
    const later = laterFrame();
    serve(framesAfterGoodStart(later.subarray(0, Math.floor(later.length / 2))));
    await expectRejected(/ends in the middle of the compressed data/);
  });

  it("rejects a file with a damaged block in a later frame", async () => {
    await installOld();
    const later = Buffer.from(laterFrame());
    // The first block header (after the 4-byte magic and a small frame header): a reserved block type.
    const descriptor = later[4];
    const headerSize =
      1 +
      ((descriptor >> 5) & 1 ? 0 : 1) +
      [0, 1, 2, 4][descriptor & 3] +
      [(descriptor >> 5) & 1 ? 1 : 0, 2, 4, 8][descriptor >> 6];
    later[4 + headerSize] |= 0b110;
    serve(framesAfterGoodStart(later));
    await expectRejected(/damaged block/);
  });

  it("rejects a file with something other than zstd after its frames", async () => {
    await installOld();
    serve(framesAfterGoodStart(Buffer.from("<html>trailing</html>")));
    await expectRejected(/unexpected data at byte/);
  });

  it("accepts several frames after a skippable one, as pzstd writes them", async () => {
    const skippable = Buffer.alloc(12);
    skippable.writeUInt32LE(0x184d2a50, 0);
    skippable.writeUInt32LE(4, 4);
    serve(Buffer.concat([skippable, content, laterFrame()]));
    const installed = await downloadDatabase(SOURCE, () => undefined);
    expect(installed.filePath).toBe(finalPath);
  });

  it("rejects valid zstd with the wrong columns", async () => {
    await installOld();
    serve(zstdCompressSync(Buffer.from("id,fen,moves\n1,x,e2e4 e7e5\n")));
    await expectRejected(/expected columns \(PuzzleId,FEN,Moves/);
  });

  it("accepts the position set's header for the position source", async () => {
    const header =
      "internal_id,lichess_game_id,move_number,lichess_url,fen,best_move,difficulty,initiative,development";
    serve(
      `${header}\n1,g,13,https://lichess.org/g#13,8/8/8/8/8/8/8/K6k w - - 0 1,a1a2,1,0,1\n`,
      "text/csv"
    );
    const installed = await downloadDatabase("chess-position-analysis-results", () => undefined);
    expect(installed.filePath).toBe(
      join(dir, "chess-position-analysis-results-chess-positions.csv")
    );
  });

  it("replaces an installed file and leaves no backup behind", async () => {
    await installOld();
    serve(content);
    await downloadDatabase(SOURCE, () => undefined);
    expect(await readFile(finalPath)).toEqual(content);
    expect(await readdir(dir)).toEqual(["lichess-puzzles-lichess_db_puzzle.csv.zst"]);
  });

  it("keeps the installed file when registering the new one fails, and finishes at once next time", async () => {
    await installOld();
    repository.failSave = true;
    const server = fakeServer(content, '"v2"');
    vi.stubGlobal("fetch", server.fetchMock);
    await expect(downloadDatabase(SOURCE, () => undefined)).rejects.toThrow("disk full");
    expect(await readFile(finalPath)).toEqual(oldContent);
    expect(await readFile(`${finalPath}.part`)).toEqual(content);
    expect(await readdir(dir)).not.toContain("lichess-puzzles-lichess_db_puzzle.csv.zst.bak");

    repository.failSave = false;
    await downloadDatabase(SOURCE, () => undefined);
    expect(server.requests.at(-1)).toEqual({
      Range: `bytes=${content.length}-`,
      "If-Range": '"v2"'
    });
    expect(await readFile(finalPath)).toEqual(content);
    expect(await readdir(dir)).toEqual(["lichess-puzzles-lichess_db_puzzle.csv.zst"]);
  });

  it("keeps the installed file when Cancel is pressed while the new one is put in place", async () => {
    await installOld();
    vi.stubGlobal("fetch", fakeServer(content, '"v2"').fetchMock);
    let release: () => void = () => undefined;
    const renaming = new Promise<void>((resolve) => {
      fsHooks.beforeRename = () => {
        fsHooks.beforeRename = null;
        resolve();
        return new Promise((done) => (release = done));
      };
    });
    const download = downloadDatabase(SOURCE, () => undefined);
    download.catch(() => undefined);
    await renaming;
    cancelDownload(SOURCE);
    release();
    await expect(download).rejects.toThrow("Download cancelled.");
    expect(await readFile(finalPath)).toEqual(oldContent);
    expect(await readFile(`${finalPath}.part`)).toEqual(content);
    expect(rows.get(SOURCE)?.filePath).toBe(finalPath);
  });

  it("keeps the installed file when quitting while the new one is put in place", async () => {
    const { cancelAllDownloads, downloadDatabase } = await freshModule();
    await installOld();
    vi.stubGlobal("fetch", fakeServer(content, '"v2"').fetchMock);
    let release: () => void = () => undefined;
    const renaming = new Promise<void>((resolve) => {
      fsHooks.beforeRename = () => {
        fsHooks.beforeRename = null;
        resolve();
        return new Promise((done) => (release = done));
      };
    });
    const download = downloadDatabase(SOURCE, () => undefined);
    download.catch(() => undefined);
    await renaming;
    await cancelAllDownloads(10);
    release();
    await expect(download).rejects.toThrow("Download cancelled.");
    expect(await readFile(finalPath)).toEqual(oldContent);
  });

  it("puts back an installed file left in its backup by an interrupted install", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(`${finalPath}.bak`, oldContent);
    rows.set(SOURCE, { id: SOURCE, sourceId: SOURCE, filePath: finalPath });
    expect((await listInstalledDatabases()).map((database) => database.filePath)).toEqual([
      finalPath
    ]);
    expect(await readFile(finalPath)).toEqual(oldContent);
    expect(await readdir(dir)).toEqual(["lichess-puzzles-lichess_db_puzzle.csv.zst"]);
  });

  /** The app died after the new copy took the file's place but before it was registered. */
  async function crashAfterSwap() {
    await installOld();
    await writeFile(`${finalPath}.bak`, oldContent);
    await writeFile(finalPath, content);
    await writeFile(`${finalPath}.part.validator`, '"v2"');
    await writeFile(`${finalPath}.installing`, String(content.length));
  }

  it("undoes a swap that was never registered when the databases are listed", async () => {
    await crashAfterSwap();
    expect((await listInstalledDatabases()).map((database) => database.filePath)).toEqual([
      finalPath
    ]);
    expect(await readFile(finalPath)).toEqual(oldContent);
    expect(await readFile(`${finalPath}.part`)).toEqual(content);
    expect((await readdir(dir)).sort()).toEqual([
      "lichess-puzzles-lichess_db_puzzle.csv.zst",
      "lichess-puzzles-lichess_db_puzzle.csv.zst.part",
      "lichess-puzzles-lichess_db_puzzle.csv.zst.part.validator"
    ]);
  });

  it("keeps an install that was registered before the app died, clearing only its leftovers", async () => {
    await crashAfterSwap();
    // Registered: the registry already describes the new copy; only the marker's removal was missed.
    rows.set(SOURCE, {
      id: SOURCE,
      sourceId: SOURCE,
      filePath: finalPath,
      fileSizeBytes: content.length
    });
    expect((await listInstalledDatabases()).map((database) => database.filePath)).toEqual([
      finalPath
    ]);
    expect(await readFile(finalPath)).toEqual(content);
    expect(rows.get(SOURCE)?.fileSizeBytes).toBe(content.length);
    expect(await readdir(dir)).toEqual(["lichess-puzzles-lichess_db_puzzle.csv.zst"]);
  });

  it("keeps the entry while an interrupted install can't be undone yet, and undoes it later", async () => {
    await crashAfterSwap();
    fsHooks.beforeRename = async () => {
      fsHooks.beforeRename = null;
      throw Object.assign(new Error("busy"), { code: "EBUSY" });
    };
    await listInstalledDatabases();
    expect(rows.has(SOURCE)).toBe(true);
    expect(await readdir(dir)).toContain("lichess-puzzles-lichess_db_puzzle.csv.zst.installing");
    expect((await listInstalledDatabases()).map((database) => database.filePath)).toEqual([
      finalPath
    ]);
    expect(await readFile(finalPath)).toEqual(oldContent);
  });

  it("keeps the installed copy when the next download after such a crash fails to register", async () => {
    await crashAfterSwap();
    repository.failSave = true;
    vi.stubGlobal("fetch", fakeServer(content, '"v2"').fetchMock);
    await expect(downloadDatabase(SOURCE, () => undefined)).rejects.toThrow("disk full");
    expect(await readFile(finalPath)).toEqual(oldContent);
    expect(await readdir(dir)).toContain("lichess-puzzles-lichess_db_puzzle.csv.zst.part");

    // Downloading again then finishes from the kept copy (the server confirms it is complete).
    repository.failSave = false;
    await downloadDatabase(SOURCE, () => undefined);
    expect(await readFile(finalPath)).toEqual(content);
    expect(await readdir(dir)).toEqual(["lichess-puzzles-lichess_db_puzzle.csv.zst"]);
  });

  it("keeps the entry of a backup that can't be put back yet, and restores it on a later listing", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(`${finalPath}.bak`, oldContent);
    rows.set(SOURCE, { id: SOURCE, sourceId: SOURCE, filePath: finalPath });
    fsHooks.beforeRename = async () => {
      fsHooks.beforeRename = null;
      throw Object.assign(new Error("busy"), { code: "EBUSY" });
    };
    expect(await listInstalledDatabases()).toEqual([]);
    expect(rows.has(SOURCE)).toBe(true);
    expect((await listInstalledDatabases()).map((database) => database.filePath)).toEqual([
      finalPath
    ]);
    expect(await readFile(finalPath)).toEqual(oldContent);
  });
});

describe("resume without Content-Length", () => {
  it("uses the size in Content-Range, so a short transfer isn't installed", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(`${finalPath}.part`, content.subarray(0, 1000));
    await writeFile(`${finalPath}.part.validator`, '"v1"');
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
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
        return new Response(stalled, {
          headers: { "content-length": String(content.length), etag: '"v1"' }
        });
      }
      seenBySecond.push({ installed: rows.has(SOURCE), files: await readdir(dir) });
      return new Response(content, {
        headers: { "content-length": String(content.length), etag: '"v2"' }
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const events: DatabaseDownloadProgress[] = [];
    const refresh = downloadDatabase(SOURCE, (progress) => events.push(progress)).catch(
      () => undefined
    );
    await vi.waitFor(() => expect(events.some((event) => event.downloadedBytes > 0)).toBe(true), {
      interval: 1
    });

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
    await expect(removeDatabase("db")).rejects.toMatchObject({
      code: expect.stringMatching(/^(EISDIR|EPERM)$/)
    });
    expect(rows.size).toBe(1);
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
    const header =
      "PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags";
    const puzzle =
      "p1,rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1,e2e4 e7e5,1500,80,90,100,short,,";
    await writeFile(
      join(dir, "lichess-puzzles-lichess_db_puzzle.csv"),
      [header, puzzle].join("\n")
    );
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
