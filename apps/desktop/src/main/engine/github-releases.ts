import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "../logger";
import type { ReleaseAssetInfo } from "./engine-manifest";
import { isRecord } from "@chaturanga/shared/types/guards";

/**
 * GitHub "latest release" lookups for engine downloads.
 *
 * Unauthenticated API calls are limited to 60/hour per IP, so every lookup goes
 * through ReleaseCache: results are kept in memory and on disk (userData) and
 * only refetched when older than the caller's max age. A rate-limit answer
 * pauses API calls until GitHub's reset time; callers then use the cached (even
 * if old) release, or the bundled fallback manifest when nothing is cached.
 */

export const GITHUB_API = "https://api.github.com";
export const RELEASE_API_TIMEOUT_MS = 10_000;
/** How long a resolved release is trusted before downloads/background checks ask GitHub again. */
export const RELEASE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export type GitHubRelease = {
  tag_name: string;
  name: string | null;
  html_url: string | null;
  published_at: string | null;
  assets: ReleaseAssetInfo[];
};

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    /** Epoch ms when the rate limit resets; set only for rate-limit answers. */
    readonly rateLimitResetAt: number | null = null
  ) {
    super(message);
    this.name = "GitHubApiError";
  }

  get rateLimited(): boolean {
    return this.rateLimitResetAt !== null;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const REPO_PATTERN = /^(?!\.)[A-Za-z0-9_.-]+\/(?!\.)[A-Za-z0-9_.-]+$/;

/** `GET /repos/{repo}/releases/latest` (the newest non-draft, non-prerelease release). */
export async function fetchLatestRelease(
  repo: string,
  opts: { fetchImpl?: FetchLike; timeoutMs?: number; userAgent?: string; now?: () => number } = {}
): Promise<GitHubRelease> {
  if (!REPO_PATTERN.test(repo)) throw new Error(`Invalid GitHub repo: ${repo}`);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  let res: Response;
  try {
    res = await fetchImpl(`${GITHUB_API}/repos/${repo}/releases/latest`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": opts.userAgent ?? "Chaturanga-Desktop",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? RELEASE_API_TIMEOUT_MS)
    });
  } catch (error) {
    throw new GitHubApiError(`GitHub API unreachable: ${error instanceof Error ? error.message : String(error)}`, null);
  }
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    const retryAfter = Number(res.headers.get("retry-after"));
    if (remaining === "0" || res.status === 429 || (Number.isFinite(retryAfter) && retryAfter > 0)) {
      const resetAt =
        Number.isFinite(reset) && reset > 0
          ? reset * 1000
          : now() + (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 60 * 60 * 1000);
      throw new GitHubApiError(`GitHub API rate limit exceeded (resets ${new Date(resetAt).toISOString()})`, res.status, resetAt);
    }
  }
  if (!res.ok) throw new GitHubApiError(`GitHub API ${res.status} for ${repo}`, res.status);
  return parseRelease(await res.json());
}

/** Validates and trims a release payload to the fields we use. Throws on an unusable payload. */
export function parseRelease(value: unknown): GitHubRelease {
  const obj = isRecord(value) ? value : null;
  if (!obj || typeof obj.tag_name !== "string" || !obj.tag_name || !Array.isArray(obj.assets)) {
    throw new GitHubApiError("Malformed GitHub release payload", null);
  }
  const assets: ReleaseAssetInfo[] = [];
  const rawAssets: unknown[] = obj.assets;
  for (const a of rawAssets) {
    if (!isRecord(a) || typeof a.name !== "string" || typeof a.browser_download_url !== "string") continue;
    if (typeof a.size !== "number" || !Number.isFinite(a.size) || a.size <= 0) continue;
    if (a.state !== undefined && a.state !== "uploaded") continue;
    assets.push({
      name: a.name,
      size: a.size,
      browser_download_url: a.browser_download_url,
      digest: typeof a.digest === "string" ? a.digest : null
    });
  }
  return {
    tag_name: obj.tag_name,
    name: typeof obj.name === "string" ? obj.name : null,
    html_url: typeof obj.html_url === "string" ? obj.html_url : null,
    published_at: typeof obj.published_at === "string" ? obj.published_at : null,
    assets
  };
}

/** `sha256:<hex>` → lowercase hex; null for absent or non-sha256 digests. */
export function parseSha256Digest(digest: string | null | undefined): string | null {
  const match = /^sha256:([0-9a-f]{64})$/i.exec(digest ?? "");
  return match ? match[1].toLowerCase() : null;
}

/* ------------------------------------------------------------------ host allow-list */

/** Hosts a GitHub release download may be served from (github.com redirects to a CDN host). */
export const RELEASE_DOWNLOAD_HOSTS: readonly string[] = [
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com"
];
/** Maia weights and their LICENSE are raw repository files. */
export const RAW_DOWNLOAD_HOSTS: readonly string[] = [...RELEASE_DOWNLOAD_HOSTS, "raw.githubusercontent.com"];

/** HTTPS on the default port, no credentials, host exactly on the list. */
export function isAllowedDownloadUrl(url: string, hosts: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    parsed.port === "" &&
    parsed.username === "" &&
    parsed.password === "" &&
    hosts.includes(parsed.hostname.toLowerCase())
  );
}

/** True when `url` is a release download of `repo` on github.com (what the API should hand us). */
export function isReleaseDownloadOf(url: string, repo: string): boolean {
  if (!isAllowedDownloadUrl(url, ["github.com"])) return false;
  const pathname = new URL(url).pathname.toLowerCase();
  return pathname.startsWith(`/${repo.toLowerCase()}/releases/download/`);
}

/* ------------------------------------------------------------------ cache */

export type CachedRelease = {
  release: GitHubRelease;
  /** Epoch ms of the successful API call. */
  fetchedAt: number;
  /** True when the cache was older than requested but GitHub couldn't be reached. */
  stale: boolean;
};

type CacheFile = { version: 1; entries: Record<string, { fetchedAt: number; release: GitHubRelease }> };

export class ReleaseCache {
  private entries = new Map<string, { fetchedAt: number; release: GitHubRelease }>();
  private inflight = new Map<string, Promise<CachedRelease | null>>();
  private errors = new Map<string, string>();
  private rateLimitedUntil = 0;
  private loaded: Promise<void> | null = null;
  private readonly fetchImpl: FetchLike | undefined;
  private readonly now: () => number;

  constructor(
    private readonly opts: {
      /** JSON cache file; null keeps the cache in memory only. */
      filePath: string | null;
      fetchImpl?: FetchLike;
      now?: () => number;
      timeoutMs?: number;
      userAgent?: string;
    }
  ) {
    this.fetchImpl = opts.fetchImpl;
    this.now = opts.now ?? Date.now;
  }

  /** The cached release without any network access. */
  async peek(repo: string): Promise<CachedRelease | null> {
    await this.load();
    const entry = this.entries.get(repo);
    return entry ? { ...entry, stale: false } : null;
  }

  /**
   * The latest release of `repo`: from cache when younger than `maxAgeMs`, otherwise from the
   * API (deduplicated per repo). When the API fails, the cached release is returned marked
   * `stale`, or null when nothing was ever cached.
   */
  async get(repo: string, opts: { maxAgeMs?: number } = {}): Promise<CachedRelease | null> {
    await this.load();
    const maxAgeMs = opts.maxAgeMs ?? RELEASE_CACHE_TTL_MS;
    const entry = this.entries.get(repo);
    if (entry && this.now() - entry.fetchedAt < maxAgeMs) return { ...entry, stale: false };
    if (this.now() < this.rateLimitedUntil) return entry ? { ...entry, stale: true } : null;

    let pending = this.inflight.get(repo);
    if (!pending) {
      pending = this.refresh(repo).finally(() => this.inflight.delete(repo));
      this.inflight.set(repo, pending);
    }
    return pending;
  }

  /** Last lookup error for `repo` (cleared on success), for the status UI. */
  lastError(repo: string): string | null {
    return this.errors.get(repo) ?? null;
  }

  private async refresh(repo: string): Promise<CachedRelease | null> {
    try {
      const release = await fetchLatestRelease(repo, {
        fetchImpl: this.fetchImpl,
        timeoutMs: this.opts.timeoutMs,
        userAgent: this.opts.userAgent,
        now: this.now
      });
      const entry = { fetchedAt: this.now(), release };
      this.entries.set(repo, entry);
      this.errors.delete(repo);
      await this.save().catch((error: unknown) => logger.warn("github-releases", "cache write failed:", error));
      return { ...entry, stale: false };
    } catch (error) {
      if (error instanceof GitHubApiError && error.rateLimitResetAt !== null) {
        this.rateLimitedUntil = error.rateLimitResetAt;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.errors.set(repo, message);
      logger.warn("github-releases", `latest release lookup for ${repo} failed:`, message);
      const entry = this.entries.get(repo);
      return entry ? { ...entry, stale: true } : null;
    }
  }

  private load(): Promise<void> {
    this.loaded ??= this.readFile();
    return this.loaded;
  }

  private async readFile(): Promise<void> {
    const file = this.opts.filePath;
    if (!file || !existsSync(file)) return;
    try {
      // A file in userData: anyone could have edited it, so each entry is checked.
      const parsed: unknown = JSON.parse(await readFile(file, "utf-8"));
      if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.entries)) return;
      for (const [repo, entry] of Object.entries(parsed.entries)) {
        if (!REPO_PATTERN.test(repo) || !isRecord(entry) || typeof entry.fetchedAt !== "number") continue;
        // Never trust a timestamp from the future (clock changes): treat it as expired.
        const fetchedAt = entry.fetchedAt > this.now() ? 0 : entry.fetchedAt;
        this.entries.set(repo, { fetchedAt, release: parseRelease(entry.release) });
      }
    } catch {
      // Corrupt cache: start empty; the next lookup refetches.
    }
  }

  private async save(): Promise<void> {
    const file = this.opts.filePath;
    if (!file) return;
    const payload: CacheFile = { version: 1, entries: Object.fromEntries(this.entries) };
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(payload, null, 2), "utf-8");
    await rename(tmp, file);
  }
}
