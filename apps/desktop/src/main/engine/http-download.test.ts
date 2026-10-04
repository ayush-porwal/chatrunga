import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => tmpdir() } }));

import { RELEASE_DOWNLOAD_HOSTS } from "./github-releases";
import { downloadToFile, parseContentRange } from "./http-download";

const URL_GH =
  "https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish.tar.gz";
const URL_CDN =
  "https://release-assets.githubusercontent.com/github-production-release-asset/1?sig=abc";
const FILE = Buffer.from(Array.from({ length: 300 }, (_, i) => i % 256));

/** Serves FILE like GitHub: github.com redirects to the CDN, which honours Range. */
function githubLike(opts: { ignoreRange?: boolean; redirectTo?: string } = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === URL_GH)
      return new Response(null, { status: 302, headers: { location: opts.redirectTo ?? URL_CDN } });
    if (url !== URL_CDN) return new Response("nope", { status: 404 });
    const range = (init?.headers as Record<string, string> | undefined)?.Range;
    const match = range && !opts.ignoreRange ? /bytes=(\d+)-/.exec(range) : null;
    if (!match) return new Response(FILE, { headers: { "content-length": String(FILE.length) } });
    const start = Number(match[1]);
    if (start >= FILE.length) {
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${FILE.length}` }
      });
    }
    return new Response(FILE.subarray(start), {
      status: 206,
      headers: {
        "content-range": `bytes ${start}-${FILE.length - 1}/${FILE.length}`,
        "content-length": String(FILE.length - start)
      }
    });
  });
}

describe("downloadToFile", () => {
  let dir: string;
  let dest: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "chaturanga-dl-"));
    dest = path.join(dir, "file.partial");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("follows the allowed redirect and reports progress against the server's length", async () => {
    const fetchImpl = githubLike();
    const progress: [number, number][] = [];
    const result = await downloadToFile({
      url: URL_GH,
      destPath: dest,
      allowedHosts: RELEASE_DOWNLOAD_HOSTS,
      expectedBytes: 10, // stale listed size: must not matter
      fetchImpl,
      onProgress: (received, total) => progress.push([received, total])
    });
    expect(result).toEqual({ bytes: 300, totalBytes: 300, resumed: false });
    expect(readFileSync(dest)).toEqual(FILE);
    expect(progress.at(-1)).toEqual([300, 300]);
    expect((fetchImpl.mock.calls[0][1] as RequestInit).redirect).toBe("manual");
  });

  it("resumes a partial that is larger than the (stale) listed size", async () => {
    writeFileSync(dest, FILE.subarray(0, 150));
    const fetchImpl = githubLike();
    const result = await downloadToFile({
      url: URL_GH,
      destPath: dest,
      allowedHosts: RELEASE_DOWNLOAD_HOSTS,
      expectedBytes: 100,
      fetchImpl
    });
    expect(result).toEqual({ bytes: 300, totalBytes: 300, resumed: true });
    expect(readFileSync(dest)).toEqual(FILE);
    const headers = fetchImpl.mock.calls[0][1]!.headers as Record<string, string>;
    expect(headers.Range).toBe("bytes=150-");
    expect(headers["Accept-Encoding"]).toBe("identity");
  });

  it("treats a 416 for a partial of exactly the full size as complete", async () => {
    writeFileSync(dest, FILE);
    const result = await downloadToFile({
      url: URL_GH,
      destPath: dest,
      allowedHosts: RELEASE_DOWNLOAD_HOSTS,
      fetchImpl: githubLike()
    });
    expect(result).toMatchObject({ bytes: 300, totalBytes: 300 });
    expect(readFileSync(dest)).toEqual(FILE);
  });

  it("starts over when the partial overshoots the real size", async () => {
    writeFileSync(dest, Buffer.concat([FILE, Buffer.from("junk")]));
    const result = await downloadToFile({
      url: URL_GH,
      destPath: dest,
      allowedHosts: RELEASE_DOWNLOAD_HOSTS,
      fetchImpl: githubLike()
    });
    expect(result).toMatchObject({ bytes: 300, resumed: false });
    expect(readFileSync(dest)).toEqual(FILE);
  });

  it("starts over when the server ignores Range", async () => {
    writeFileSync(dest, Buffer.from("stale bytes"));
    const result = await downloadToFile({
      url: URL_GH,
      destPath: dest,
      allowedHosts: RELEASE_DOWNLOAD_HOSTS,
      fetchImpl: githubLike({ ignoreRange: true })
    });
    expect(result).toMatchObject({ bytes: 300, resumed: false });
    expect(readFileSync(dest)).toEqual(FILE);
  });

  it("rejects a redirect to a host outside the allow-list before downloading", async () => {
    const fetchImpl = githubLike({ redirectTo: "https://evil.example/stockfish.tar.gz" });
    await expect(
      downloadToFile({
        url: URL_GH,
        destPath: dest,
        allowedHosts: RELEASE_DOWNLOAD_HOSTS,
        fetchImpl
      })
    ).rejects.toThrow(/evil\.example.*not an allowed GitHub host/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(existsSync(dest)).toBe(false);
  });

  it("rejects a disallowed start URL without any request", async () => {
    const fetchImpl = githubLike();
    await expect(
      downloadToFile({
        url: "http://github.com/x",
        destPath: dest,
        allowedHosts: RELEASE_DOWNLOAD_HOSTS,
        fetchImpl
      })
    ).rejects.toThrow(/not an allowed GitHub host/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps a short download for the next resume", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(FILE.subarray(0, 120), { headers: { "content-length": String(FILE.length) } })
    );
    await expect(
      downloadToFile({
        url: URL_CDN,
        destPath: dest,
        allowedHosts: RELEASE_DOWNLOAD_HOSTS,
        fetchImpl
      })
    ).rejects.toThrow("download incomplete: 120 of 300 bytes");
    expect(readFileSync(dest).length).toBe(120);
  });

  it("parses Content-Range", () => {
    expect(parseContentRange("bytes 150-299/300")).toEqual({ start: 150, total: 300 });
    expect(parseContentRange("bytes */300")).toEqual({ start: null, total: 300 });
    expect(parseContentRange("bytes 0-9/*")).toEqual({ start: 0, total: null });
    expect(parseContentRange("garbage")).toBeNull();
    expect(parseContentRange(null)).toBeNull();
  });
});
