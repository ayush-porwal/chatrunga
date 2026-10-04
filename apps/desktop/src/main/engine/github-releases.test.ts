import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => tmpdir() } }));

import sf19 from "./__fixtures__/github/stockfish-latest-sf_19.json";
import sf171 from "./__fixtures__/github/stockfish-sf_17.1.json";
import {
  GitHubApiError,
  RAW_DOWNLOAD_HOSTS,
  RELEASE_CACHE_TTL_MS,
  RELEASE_DOWNLOAD_HOSTS,
  ReleaseCache,
  fetchLatestRelease,
  isAllowedDownloadUrl,
  isReleaseDownloadOf,
  parseRelease,
  parseSha256Digest,
  type FetchLike
} from "./github-releases";

const SF_API = "https://api.github.com/repos/official-stockfish/Stockfish/releases/latest";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

/** GitHub's unauthenticated rate-limit answer. */
const rateLimited = (resetEpochSeconds: number) =>
  json(
    { message: "API rate limit exceeded for 203.0.113.7.", documentation_url: "https://docs.github.com/rest" },
    { status: 403, headers: { "x-ratelimit-limit": "60", "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(resetEpochSeconds) } }
  );

describe("fetchLatestRelease", () => {
  it("calls the releases/latest endpoint with GitHub headers and a timeout", async () => {
    const fetchImpl = vi.fn(async () => json(sf19));
    const release = await fetchLatestRelease("official-stockfish/Stockfish", { fetchImpl, userAgent: "Test/1" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(SF_API);
    expect(init.headers).toMatchObject({ Accept: "application/vnd.github+json", "User-Agent": "Test/1" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(release.tag_name).toBe("sf_19");
    expect(release.assets).toHaveLength(sf19.assets.length);
  });

  it("reports a rate limit (403 + x-ratelimit-remaining: 0) with its reset time", async () => {
    const error = await fetchLatestRelease("official-stockfish/Stockfish", {
      fetchImpl: async () => rateLimited(1_790_437_455)
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubApiError);
    expect((error as GitHubApiError).rateLimited).toBe(true);
    expect((error as GitHubApiError).rateLimitResetAt).toBe(1_790_437_455_000);
  });

  it("treats other failures as plain errors", async () => {
    const notFound = await fetchLatestRelease("a/b", { fetchImpl: async () => json({}, { status: 404 }) }).catch((e: unknown) => e);
    expect((notFound as GitHubApiError).rateLimited).toBe(false);
    const offline = await fetchLatestRelease("a/b", {
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      }
    }).catch((e: unknown) => e);
    expect((offline as Error).message).toMatch(/unreachable/);
    await expect(fetchLatestRelease("../evil", { fetchImpl: async () => json(sf19) })).rejects.toThrow(/Invalid GitHub repo/);
  });

  it("keeps only usable assets and tolerates missing digests (older releases)", () => {
    const parsed = parseRelease(sf171);
    expect(parsed.assets.every((a) => a.digest === null)).toBe(true);
    const odd = parseRelease({ tag_name: "x", assets: [{ name: "a" }, { name: "b", size: 1, browser_download_url: "u", state: "starter" }] });
    expect(odd.assets).toEqual([]);
    expect(() => parseRelease({ assets: [] })).toThrow(/Malformed/);
  });
});

describe("digest + host checks", () => {
  it("parses sha256 digests only", () => {
    expect(parseSha256Digest("sha256:A1F0E3BCC5A6927A11FE6FC8E54A779754645F3C2BAE2CF13420FD1957ADAA77")).toBe(
      "a1f0e3bcc5a6927a11fe6fc8e54a779754645f3c2bae2cf13420fd1957adaa77"
    );
    expect(parseSha256Digest("sha512:abcd")).toBeNull();
    expect(parseSha256Digest("sha256:1234")).toBeNull();
    expect(parseSha256Digest(null)).toBeNull();
  });

  it("allows only HTTPS GitHub download hosts", () => {
    const ok = [
      "https://github.com/official-stockfish/Stockfish/releases/download/sf_19/x.tar.gz",
      "https://objects.githubusercontent.com/github-production-release-asset/1",
      "https://release-assets.githubusercontent.com/github-production-release-asset/1?sig=x"
    ];
    for (const url of ok) expect(isAllowedDownloadUrl(url, RELEASE_DOWNLOAD_HOSTS), url).toBe(true);
    const bad = [
      "http://github.com/a/b",
      "https://github.com.evil.example/a",
      "https://evil.example/github.com",
      "https://user:pw@github.com/a",
      "https://github.com:8443/a",
      "https://raw.githubusercontent.com/CSSLab/maia-chess/master/maia_weights/maia-1100.pb.gz",
      "not a url"
    ];
    for (const url of bad) expect(isAllowedDownloadUrl(url, RELEASE_DOWNLOAD_HOSTS), url).toBe(false);
    expect(isAllowedDownloadUrl(bad[5], RAW_DOWNLOAD_HOSTS)).toBe(true);
  });

  it("checks that a release URL belongs to the expected repo", () => {
    const url = sf19.assets[0].browser_download_url;
    expect(isReleaseDownloadOf(url, "official-stockfish/Stockfish")).toBe(true);
    expect(isReleaseDownloadOf(url, "LeelaChessZero/lc0")).toBe(false);
    expect(isReleaseDownloadOf("https://github.com/someone/Stockfish/releases/download/sf_19/x", "official-stockfish/Stockfish")).toBe(false);
  });
});

describe("ReleaseCache", () => {
  let dir: string;
  let now: number;
  let fetchImpl: ReturnType<typeof vi.fn<FetchLike>>;
  const cacheFile = () => path.join(dir, "engine-releases-cache.json");
  const makeCache = () => new ReleaseCache({ filePath: cacheFile(), fetchImpl, now: () => now });

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "chaturanga-releases-"));
    now = 1_790_000_000_000;
    fetchImpl = vi.fn<FetchLike>(async () => json(sf19));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves from memory and disk within the TTL, refetching after it", async () => {
    const cache = makeCache();
    expect((await cache.get("official-stockfish/Stockfish"))?.release.tag_name).toBe("sf_19");
    now += RELEASE_CACHE_TTL_MS - 1;
    await cache.get("official-stockfish/Stockfish");
    // A new process (fresh instance) reads the cache file instead of calling the API.
    await makeCache().get("official-stockfish/Stockfish");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(cacheFile(), "utf-8"))).toMatchObject({
      entries: { "official-stockfish/Stockfish": { release: { tag_name: "sf_19" } } }
    });

    now += 2;
    await cache.get("official-stockfish/Stockfish");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("honours a shorter max age for explicit checks and dedupes concurrent lookups", async () => {
    const cache = makeCache();
    await Promise.all([cache.get("official-stockfish/Stockfish"), cache.get("official-stockfish/Stockfish")]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now += 61_000;
    await cache.get("official-stockfish/Stockfish", { maxAgeMs: 60_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("peek never touches the network", async () => {
    const cache = makeCache();
    expect(await cache.peek("official-stockfish/Stockfish")).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns the stale cached release when rate limited, and pauses calls until the reset", async () => {
    const cache = makeCache();
    await cache.get("official-stockfish/Stockfish");
    now += RELEASE_CACHE_TTL_MS + 1;
    const resetSeconds = Math.floor(now / 1000) + 600;
    fetchImpl.mockImplementation(async () => rateLimited(resetSeconds));

    const stale = await cache.get("official-stockfish/Stockfish");
    expect(stale).toMatchObject({ stale: true, release: { tag_name: "sf_19" } });
    expect(cache.lastError("official-stockfish/Stockfish")).toMatch(/rate limit/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // Still inside the rate-limit window: no further API calls, for any repo.
    expect(await cache.get("LeelaChessZero/lc0")).toBeNull();
    await cache.get("official-stockfish/Stockfish", { maxAgeMs: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    now = resetSeconds * 1000 + 1;
    fetchImpl.mockImplementation(async () => json(sf19));
    expect(await cache.get("official-stockfish/Stockfish")).toMatchObject({ stale: false });
    expect(cache.lastError("official-stockfish/Stockfish")).toBeNull();
  });

  it("returns null when the API fails and nothing is cached", async () => {
    fetchImpl.mockImplementation(async () => {
      throw new TypeError("getaddrinfo ENOTFOUND api.github.com");
    });
    expect(await makeCache().get("official-stockfish/Stockfish")).toBeNull();
  });

  it("ignores a corrupt cache file and future timestamps", async () => {
    writeFileSync(cacheFile(), "{not json");
    expect((await makeCache().get("official-stockfish/Stockfish"))?.release.tag_name).toBe("sf_19");
    const future = { version: 1, entries: { "official-stockfish/Stockfish": { fetchedAt: now + 1e9, release: sf171 } } };
    writeFileSync(cacheFile(), JSON.stringify(future));
    expect((await makeCache().get("official-stockfish/Stockfish"))?.release.tag_name).toBe("sf_19");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
