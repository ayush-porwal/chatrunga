import { app } from "electron";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EventEmitter } from "node:events";
import { logger } from "../logger";
import { cpuFeatures as detectCpuFeatures } from "./cpu-features";
import {
  ENGINE_MANIFEST,
  RELEASE_SOURCES,
  currentPlatformKey,
  isDifferentVersion,
  manifestVersionFor,
  resolveManifestEntry,
  selectReleaseAsset,
  type ArchiveKind,
  type CpuFeature,
  type EngineManifest,
  type PlatformKey,
  type ReleaseAssetId
} from "./engine-manifest";
import {
  RAW_DOWNLOAD_HOSTS,
  RELEASE_CACHE_TTL_MS,
  RELEASE_DOWNLOAD_HOSTS,
  ReleaseCache,
  isAllowedDownloadUrl,
  isReleaseDownloadOf,
  parseSha256Digest,
  type FetchLike
} from "./github-releases";
import { downloadToFile } from "./http-download";

const exec = promisify(execFile);

/**
 * Asset manager — installs Stockfish, Lc0 and the Maia weights and tracks them across launches.
 *
 * Where downloads come from (see ./engine-manifest.ts):
 * - Stockfish / Lc0: the upstream GitHub "latest release", resolved via the REST API and
 *   cached (./github-releases.ts). The release asset for this platform is picked by pattern;
 *   its `size` drives progress, its `digest` (sha256) is verified, its tag is the installed
 *   version. When GitHub can't be reached and nothing is cached, the bundled fallback
 *   manifest (last known-good URLs) is used.
 * - Maia weights: fixed raw.githubusercontent.com URLs (they are not versioned releases).
 *
 * Install pipeline: download (resumable, host allow-listed) → verify (sha256 digest when
 * published, and the server-reported length) → extract into a staging dir → chmod / clear
 * quarantine → atomic rename over the installed file. The install path never changes, so an
 * update keeps the engines table pointing at the same file. Nothing downloaded is executed
 * here. One retry on failure (a digest mismatch discards the partial first).
 *
 * Updates are never applied silently: status() reports `updateAvailable` and the user
 * triggers downloadAsset() again.
 *
 * State lives in JSON at `userData/engine-assets.json` (release cache next to it).
 */

const STATE_FILE = "engine-assets.json";
const RELEASE_CACHE_FILE = "engine-releases-cache.json";
/** An explicit "check for updates" reuses a lookup this recent instead of asking GitHub again. */
const CHECK_MAX_AGE_MS = 60 * 1000;

export type AssetId = "stockfish" | "lc0" | "maia-1100" | "maia-1300" | "maia-1500" | "maia-1700" | "maia-1900";

export type AssetState = "missing" | "installed" | "custom";

/** Where a download (or install) came from. */
export type AssetSource = "github" | "fallback" | "fixed";

export type AssetRecord = {
  id: AssetId;
  state: AssetState;
  /** Local path to the installed binary or weight file. */
  installedPath: string | null;
  /** The user's own file, chosen in Settings → Engine downloads. */
  customPath: string | null;
  /** sha256 of the installed file. */
  sha256: string | null;
  /**
   * Installed version: the release tag for engines (`sf_19`), `v1.0` for Maia. Older state
   * files recorded a bare version (`17.1`) here; compare with normalizeVersion().
   */
  manifestVersion: string | null;
  /** Installed release tag (same as manifestVersion for new installs); absent in older state files. */
  version?: string | null;
  /** Where the install came from; absent in older state files. */
  source?: AssetSource | null;
  /** Bytes on disk. */
  sizeBytes: number;
  /** ISO timestamp of install. */
  installedAt: string | null;
};

/** getStatus() entry: the installed record plus what is available upstream. */
export type AssetStatus = AssetRecord & {
  installedVersion: string | null;
  /** Newest known version (release tag); null when it can't be resolved (manual install). */
  latestVersion: string | null;
  /** Installed (managed) and GitHub reports a different latest release. */
  updateAvailable: boolean;
  /** Size of the file a download would fetch; null when not auto-downloadable. */
  downloadSizeBytes: number | null;
  /** Where `latestVersion` / `downloadSizeBytes` came from. */
  latestSource: AssetSource | null;
  /** False when this platform needs a manual install (Lc0 on macOS / Linux). */
  autoDownload: boolean;
  installInstructions: string | null;
  /** When the upstream release was last fetched from GitHub (ISO), if ever. */
  checkedAt: string | null;
  /** Last lookup error (e.g. rate limited) while a cached/fallback answer is shown. */
  checkError: string | null;
};

export type ProgressEvent =
  | { type: "download"; assetId: AssetId; bytesReceived: number; bytesTotal: number }
  | { type: "verify"; assetId: AssetId }
  | { type: "install"; assetId: AssetId }
  | { type: "ready"; assetId: AssetId }
  | { type: "error"; assetId: AssetId; message: string };

export const ALL_ASSET_IDS: readonly AssetId[] = [
  "stockfish",
  "lc0",
  "maia-1100",
  "maia-1300",
  "maia-1500",
  "maia-1700",
  "maia-1900"
];

export function isAssetId(value: unknown): value is AssetId {
  return ALL_ASSET_IDS.includes(value as AssetId);
}

function isReleaseAsset(id: AssetId): id is ReleaseAssetId {
  return id === "stockfish" || id === "lc0";
}

/** A concrete download: what to fetch, how to check it, and how to install it. */
export type ResolvedDownload = {
  id: AssetId;
  url: string;
  sizeBytes: number;
  /** Expected sha256 (hex); null when upstream publishes none (fallback / Maia). */
  sha256: string | null;
  extract: ArchiveKind | null;
  executablePattern: string | null;
  version: string;
  source: AssetSource;
  /** Upstream file name, used to key partial downloads. */
  assetName: string;
  /** Epoch ms of the GitHub lookup this came from. */
  checkedAt: number | null;
  checkError: string | null;
};

export class DigestMismatchError extends Error {
  constructor(id: AssetId) {
    super(`sha256 mismatch for ${id}`);
    this.name = "DigestMismatchError";
  }
}

/** Minimum gap between download progress events (they are relayed to the renderer). */
const PROGRESS_INTERVAL_MS = 100;

export type AssetManagerOptions = {
  userDataDir: string;
  manifest?: EngineManifest;
  fetchImpl?: FetchLike;
  /** Defaults to this machine. */
  platformKey?: PlatformKey | null;
  /** Defaults to runtime detection. */
  cpuFeatures?: () => Promise<ReadonlySet<CpuFeature> | null>;
  releaseCache?: ReleaseCache;
  userAgent?: string;
};

export class AssetManager extends EventEmitter<{ progress: [ProgressEvent]; statusChanged: [] }> {
  private state: Map<AssetId, AssetRecord> = new Map();
  private statePath: string;
  private enginesDir: string;
  private manifest: EngineManifest;
  private fetchImpl: FetchLike | undefined;
  private platformKey: PlatformKey | null;
  private cpuFeatures: () => Promise<ReadonlySet<CpuFeature> | null>;
  private releases: ReleaseCache;
  private inflight = new Map<AssetId, Promise<void>>();
  /** Tail of the serialized state-file writes (see saveState). */
  private stateWrites: Promise<void> = Promise.resolve();
  private stateWriteSeq = 0;

  constructor(opts: AssetManagerOptions) {
    super();
    this.enginesDir = path.join(opts.userDataDir, "engines");
    this.statePath = path.join(opts.userDataDir, STATE_FILE);
    this.manifest = opts.manifest ?? ENGINE_MANIFEST;
    this.fetchImpl = opts.fetchImpl;
    this.platformKey = opts.platformKey !== undefined ? opts.platformKey : currentPlatformKey();
    this.cpuFeatures = opts.cpuFeatures ?? detectCpuFeatures;
    this.releases =
      opts.releaseCache ??
      new ReleaseCache({
        filePath: path.join(opts.userDataDir, RELEASE_CACHE_FILE),
        fetchImpl: opts.fetchImpl,
        userAgent: opts.userAgent
      });
  }

  async init(): Promise<void> {
    await mkdir(this.enginesDir, { recursive: true });
    await this.loadState();
    await this.cleanupLeftovers();
  }

  getInstalled(): Record<AssetId, AssetRecord> {
    const out = {} as Record<AssetId, AssetRecord>;
    for (const id of ALL_ASSET_IDS) {
      out[id] = this.state.get(id) ?? this.emptyRecord(id);
    }
    return out;
  }

  /**
   * Installed state plus the latest upstream version / download size per asset. Without
   * `refresh` no network request is made (cached release or fallback manifest); with it,
   * GitHub is asked unless a lookup happened in the last minute.
   */
  async getStatus(opts: { refresh?: boolean } = {}): Promise<Record<AssetId, AssetStatus>> {
    const lookup = opts.refresh ? { maxAgeMs: CHECK_MAX_AGE_MS } : ("cache-only" as const);
    const out = {} as Record<AssetId, AssetStatus>;
    const installed = this.getInstalled();
    await Promise.all(
      ALL_ASSET_IDS.map(async (id) => {
        const record = installed[id];
        const resolved = await this.resolveDownload(id, lookup).catch(() => null);
        const installedVersion = record.version ?? record.manifestVersion ?? null;
        const managed = record.state === "installed";
        out[id] = {
          ...record,
          installedVersion,
          latestVersion: resolved?.version ?? null,
          // Only a live (or cached) GitHub answer can say there is something newer: the
          // fallback manifest may well be older than what is installed.
          updateAvailable:
            managed && resolved?.source === "github" && isDifferentVersion(installedVersion, resolved.version),
          downloadSizeBytes: resolved?.sizeBytes ?? null,
          latestSource: resolved?.source ?? null,
          autoDownload: resolved !== null,
          installInstructions: resolved ? null : this.installInstructionsFor(id),
          checkedAt: resolved?.checkedAt ? new Date(resolved.checkedAt).toISOString() : null,
          checkError: resolved?.checkError ?? null
        };
      })
    );
    return out;
  }

  /** Explicit "check for updates": refreshes the releases (rate-limit aware) and returns status. */
  async checkForUpdates(): Promise<Record<AssetId, AssetStatus>> {
    const status = await this.getStatus({ refresh: true });
    this.emit("statusChanged");
    return status;
  }

  /**
   * Background lookup at app start. Honors the on-disk cache TTL, so restarts within the TTL
   * make no API call. Emits `statusChanged` when done.
   */
  async refreshReleasesInBackground(): Promise<void> {
    const repos = this.releaseReposForPlatform();
    await Promise.all(repos.map((repo) => this.releases.get(repo, { maxAgeMs: RELEASE_CACHE_TTL_MS })));
    this.emit("statusChanged");
  }

  /**
   * What downloadAsset() would fetch for `id`. `lookup` is either a max cache age for the
   * GitHub release, or "cache-only" (never touches the network). Null = manual install.
   */
  async resolveDownload(
    id: AssetId,
    lookup: { maxAgeMs: number } | "cache-only" = { maxAgeMs: RELEASE_CACHE_TTL_MS }
  ): Promise<ResolvedDownload | null> {
    if (!isReleaseAsset(id)) {
      const entry = this.manifest.maiaWeights.files[id];
      return {
        id,
        url: entry.url,
        sizeBytes: entry.sizeBytes,
        sha256: entry.sha256 ?? null,
        extract: null,
        executablePattern: null,
        version: this.manifest.maiaWeights.version,
        source: "fixed",
        assetName: path.posix.basename(new URL(entry.url).pathname),
        checkedAt: null,
        checkError: null
      };
    }

    const source = RELEASE_SOURCES[id];
    const matcher = this.platformKey ? source.platforms[this.platformKey] : undefined;
    if (!matcher) return null;

    const cached = lookup === "cache-only" ? await this.releases.peek(source.repo) : await this.releases.get(source.repo, lookup);
    let checkError = this.releases.lastError(source.repo);
    if (cached) {
      const selected = selectReleaseAsset(cached.release.assets, matcher, await this.cpuFeatures());
      if (selected && isReleaseDownloadOf(selected.asset.browser_download_url, source.repo)) {
        return {
          id,
          url: selected.asset.browser_download_url,
          sizeBytes: selected.asset.size,
          sha256: parseSha256Digest(selected.asset.digest),
          extract: selected.extract,
          executablePattern: selected.executablePattern,
          version: cached.release.tag_name,
          source: "github",
          assetName: selected.asset.name,
          checkedAt: cached.fetchedAt,
          checkError: cached.stale ? checkError : null
        };
      }
      checkError = `No ${this.platformKey} build found in ${source.repo} ${cached.release.tag_name}`;
      logger.warn("asset-manager", `${checkError}; using the bundled fallback`);
    }

    const entry = resolveManifestEntry(this.manifest, id, this.platformKey);
    if (!entry) return null;
    return {
      id,
      url: entry.url,
      sizeBytes: entry.sizeBytes,
      sha256: entry.sha256 ?? null,
      extract: entry.extract ?? null,
      executablePattern: entry.executablePattern ?? null,
      version: manifestVersionFor(this.manifest, id),
      source: "fallback",
      assetName: path.posix.basename(new URL(entry.url).pathname),
      checkedAt: cached?.fetchedAt ?? null,
      checkError
    };
  }

  /** Installs (or updates to) the latest version of `id`. Concurrent calls share one run. */
  downloadAsset(id: AssetId): Promise<void> {
    let pending = this.inflight.get(id);
    if (!pending) {
      pending = this.runDownload(id).finally(() => this.inflight.delete(id));
      this.inflight.set(id, pending);
    }
    return pending;
  }

  private async runDownload(id: AssetId): Promise<void> {
    let resolved: ResolvedDownload | null;
    try {
      resolved = await this.resolveDownload(id);
      if (!resolved) throw new Error(this.manualInstallMessage(id));
    } catch (error) {
      this.emit("progress", { type: "error", assetId: id, message: errorText(error) });
      throw error;
    }

    // CC attribution: pull LICENSE alongside Maia weights so credit travels
    // with the install. Cheap, best-effort, doesn't block.
    if (id.startsWith("maia-")) {
      await this.fetchMaiaLicense(this.manifest.licenses.maia.noticeUrl).catch((err: unknown) => {
        logger.warn("asset-manager", "LICENSE_MAIA.txt fetch failed:", err);
      });
    }

    const finalPath = path.join(this.enginesDir, this.fileNameFor(id));
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.install(resolved, finalPath);
        this.state.set(id, {
          id,
          state: "installed",
          installedPath: finalPath,
          customPath: null,
          sha256: await sha256File(finalPath).catch(() => null),
          manifestVersion: resolved.version,
          version: resolved.version,
          source: resolved.source,
          sizeBytes: statSync(finalPath).size,
          installedAt: new Date().toISOString()
        });
        await this.saveState();
        this.emit("progress", { type: "ready", assetId: id });
        this.emit("statusChanged");
        return;
      } catch (error) {
        if (attempt >= 2 || error instanceof DisallowedDownloadError) {
          this.emit("progress", { type: "error", assetId: id, message: errorText(error) });
          throw error;
        }
        logger.warn("asset-manager", `install of ${id} failed, retrying:`, errorText(error));
      }
    }
  }

  /** download → verify → extract/stage → atomic swap into `finalPath`. */
  private async install(resolved: ResolvedDownload, finalPath: string): Promise<void> {
    const { id } = resolved;
    const hosts = isReleaseAsset(id) ? RELEASE_DOWNLOAD_HOSTS : RAW_DOWNLOAD_HOSTS;
    if (!isAllowedDownloadUrl(resolved.url, hosts)) throw new DisallowedDownloadError(resolved.url);

    // Partials are keyed by upstream version + file name, so a resumed download can never
    // splice bytes from two different releases together.
    const downloadsDir = path.join(this.enginesDir, ".downloads");
    await mkdir(downloadsDir, { recursive: true });
    const partialPath = path.join(downloadsDir, `${id}--${safeName(resolved.version)}--${safeName(resolved.assetName)}.partial`);

    await downloadToFile({
      url: resolved.url,
      destPath: partialPath,
      allowedHosts: hosts,
      expectedBytes: resolved.sizeBytes,
      fetchImpl: this.fetchImpl,
      progressIntervalMs: PROGRESS_INTERVAL_MS,
      onProgress: (bytesReceived, bytesTotal) =>
        this.emit("progress", { type: "download", assetId: id, bytesReceived, bytesTotal })
    }).catch((error: unknown) => {
      if (error instanceof Error && error.name === "DisallowedUrlError") throw new DisallowedDownloadError(resolved.url);
      throw error;
    });

    this.emit("progress", { type: "verify", assetId: id });
    if (resolved.sha256) {
      const actual = await sha256File(partialPath);
      if (actual !== resolved.sha256) {
        await unlink(partialPath).catch(() => {});
        throw new DigestMismatchError(id);
      }
    } else {
      logger.info("asset-manager", `${id}: no upstream digest (${resolved.source}); verified by length only`);
    }

    this.emit("progress", { type: "install", assetId: id });
    const stagingDir = await mkdtemp(path.join(this.enginesDir, `.staging-${id}-`));
    try {
      let staged: string;
      if (resolved.extract) {
        if (!resolved.executablePattern) throw new Error(`No executable pattern for ${id}`);
        const extractDir = path.join(stagingDir, "extract");
        await mkdir(extractDir);
        await this.extractArchive(partialPath, extractDir, resolved.extract);
        const found = await findExecutable(extractDir, new RegExp(resolved.executablePattern, "i"));
        if (!found) throw new Error(`Executable not found in ${resolved.assetName} for ${id}`);
        staged = path.join(stagingDir, path.basename(finalPath));
        await rename(found, staged);
        await unlink(partialPath).catch(() => {});
      } else {
        staged = path.join(stagingDir, path.basename(finalPath));
        await rename(partialPath, staged);
      }
      await this.applyExecPermissions(staged);
      await this.stripQuarantine(staged);
      await swapIntoPlace(staged, finalPath);
    } finally {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async extractArchive(archivePath: string, destDir: string, kind: ArchiveKind): Promise<void> {
    // System tools only, no npm deps. `tar -xf` detects gzip/xz itself and, being bsdtar on
    // macOS and Windows 10+, also reads zip; GNU tar on Linux can't, so zip uses unzip there.
    // Both refuse absolute paths and `..` entries by default.
    if (kind === "zip" && process.platform === "linux") {
      await exec("unzip", ["-o", "-q", archivePath, "-d", destDir]);
      return;
    }
    await exec("tar", ["-xf", archivePath, "-C", destDir]);
  }

  /**
   * Download many assets, reporting per-asset failures via progress events
   * rather than throwing. Returns a summary so callers can react if NOTHING
   * succeeded; the renderer surfaces this without an IPC reject.
   */
  async downloadAll(
    ids: readonly AssetId[] = ALL_ASSET_IDS,
    concurrency = 3
  ): Promise<{ succeeded: AssetId[]; failed: { id: AssetId; reason: string }[] }> {
    const succeeded: AssetId[] = [];
    const failed: { id: AssetId; reason: string }[] = [];
    const queue = [...ids];
    const running: Promise<void>[] = [];
    while (queue.length > 0 || running.length > 0) {
      while (running.length < concurrency && queue.length > 0) {
        const id = queue.shift()!;
        const promise = this.downloadAsset(id)
          .then(() => {
            succeeded.push(id);
          })
          .catch((err: unknown) => {
            failed.push({ id, reason: errorText(err) });
          })
          .finally(() => {
            running.splice(running.indexOf(promise), 1);
          });
        running.push(promise);
      }
      if (running.length > 0) await Promise.race(running.map((p) => p.catch(() => undefined)));
    }
    return { succeeded, failed };
  }

  async removeAsset(id: AssetId): Promise<void> {
    const record = this.state.get(id);
    // Only delete files we installed; a custom path is the user's own file.
    if (record?.installedPath && record.state !== "custom") {
      await unlink(record.installedPath).catch(() => {});
    }
    this.state.delete(id);
    await this.saveState();
    this.emit("statusChanged");
  }

  async setCustomPath(id: AssetId, customPath: string): Promise<void> {
    if (!existsSync(customPath)) throw new Error(`Custom path does not exist: ${customPath}`);
    const sha256 = await sha256File(customPath);
    const sizeBytes = statSync(customPath).size;
    this.state.set(id, {
      id,
      state: "custom",
      installedPath: customPath,
      customPath,
      sha256,
      manifestVersion: null,
      version: null,
      source: null,
      sizeBytes,
      installedAt: new Date().toISOString()
    });
    await this.saveState();
    this.emit("statusChanged");
  }

  private releaseReposForPlatform(): string[] {
    const key = this.platformKey;
    if (!key) return [];
    return Object.values(RELEASE_SOURCES)
      .filter((source) => source.platforms[key])
      .map((source) => source.repo);
  }

  private installInstructionsFor(id: AssetId): string | null {
    if (id === "lc0" && this.platformKey) return this.manifest.lc0.installInstructions[this.platformKey];
    return null;
  }

  private manualInstallMessage(id: AssetId): string {
    // Lc0 is the known case: upstream publishes no macOS / Linux binaries.
    const instruction = this.installInstructionsFor(id);
    if (instruction) {
      return `Lc0 doesn't ship Mac/Linux binaries on GitHub. Install it yourself: ${instruction}. Then choose the lc0 binary in Settings → Engine downloads.`;
    }
    return `No download available for ${id} on ${process.platform}-${process.arch}.`;
  }

  private fileNameFor(id: AssetId): string {
    if (id === "stockfish") return process.platform === "win32" ? "stockfish.exe" : "stockfish";
    if (id === "lc0") return process.platform === "win32" ? "lc0.exe" : "lc0";
    return `${id}.pb.gz`;
  }

  private async applyExecPermissions(filePath: string): Promise<void> {
    if (process.platform === "win32") return;
    if (filePath.endsWith(".pb.gz")) return; // Weights aren't executables.
    await chmod(filePath, 0o755);
  }

  /**
   * macOS quarantine strip, so the verified binary runs without Gatekeeper's first-run
   * dialog (the app itself is signed/notarized, or accepted as unsigned in alpha).
   * Windows: PowerShell Unblock-File clears Mark-of-the-Web. Linux: no-op.
   */
  private async stripQuarantine(filePath: string): Promise<void> {
    if (process.platform === "darwin") {
      await exec("xattr", ["-d", "com.apple.quarantine", filePath]).catch(() => {});
      return;
    }
    if (process.platform === "win32") {
      const literal = filePath.replaceAll("'", "''");
      await exec("powershell.exe", ["-NoProfile", "-Command", `Unblock-File -LiteralPath '${literal}'`]).catch(() => {});
    }
  }

  /** Staging dirs and swapped-out binaries left by an interrupted install / a running engine. */
  private async cleanupLeftovers(): Promise<void> {
    const entries = await readdir(this.enginesDir).catch(() => [] as string[]);
    await Promise.all(
      entries
        .filter((name) => name.startsWith(".staging-") || /\.old-\d+$/.test(name))
        .map((name) => rm(path.join(this.enginesDir, name), { recursive: true, force: true }).catch(() => {}))
    );
  }

  private async loadState(): Promise<void> {
    if (!existsSync(this.statePath)) return;
    try {
      const raw = await readFile(this.statePath, "utf-8");
      const parsed = JSON.parse(raw) as { records?: AssetRecord[] };
      let changed = false;
      for (const record of parsed.records ?? []) {
        if (!isAssetId(record?.id)) continue;
        const restored = this.withExistingFiles(record);
        changed ||= restored !== record;
        this.state.set(record.id, restored);
      }
      if (changed) await this.saveState();
    } catch {
      // Corrupt state file — start fresh. Engines will re-download on demand.
    }
  }

  /**
   * A binary/weight deleted or moved outside the app must not be restored as installed:
   * startup registry sync would advertise an engine that can't spawn and onboarding would
   * stay suppressed. Missing files turn the record back into `missing`.
   */
  private withExistingFiles(record: AssetRecord): AssetRecord {
    if (record.state === "missing") return record;
    const file = record.state === "custom" ? record.customPath : record.installedPath;
    return file && existsSync(file) ? record : this.emptyRecord(record.id);
  }

  /**
   * Concurrent installs (downloadAll runs several) each persist on completion. Writes are
   * queued so they never interleave, each snapshots the latest state when it runs, and each
   * uses its own temp file so a rename can never pick up another write's file.
   */
  private saveState(): Promise<void> {
    const write = async () => {
      const payload = { records: [...this.state.values()] };
      const tmp = `${this.statePath}.${process.pid}.${++this.stateWriteSeq}.tmp`;
      await writeFile(tmp, JSON.stringify(payload, null, 2), "utf-8");
      await rename(tmp, this.statePath);
    };
    const next = this.stateWrites.then(write, write);
    this.stateWrites = next.catch(() => {});
    return next;
  }

  private async fetchMaiaLicense(url: string): Promise<void> {
    const licensePath = path.join(this.enginesDir, "LICENSE_MAIA.txt");
    if (existsSync(licensePath)) return;
    if (!isAllowedDownloadUrl(url, RAW_DOWNLOAD_HOSTS)) throw new DisallowedDownloadError(url);
    const res = await (this.fetchImpl ?? fetch)(url, { redirect: "error" });
    if (!res.ok) throw new Error(`license fetch failed: ${res.status}`);
    const text = await res.text();
    await writeFile(licensePath, text, "utf-8");
  }

  private emptyRecord(id: AssetId): AssetRecord {
    return {
      id,
      state: "missing",
      installedPath: null,
      customPath: null,
      sha256: null,
      manifestVersion: null,
      sizeBytes: 0,
      installedAt: null
    };
  }
}

export class DisallowedDownloadError extends Error {
  constructor(url: string) {
    let host = "an invalid URL";
    try {
      host = new URL(url).host;
    } catch {
      // keep the placeholder
    }
    super(`Refusing to download from ${host}: only GitHub download hosts are allowed`);
    this.name = "DisallowedDownloadError";
  }
}

/**
 * Moves `staged` over `finalPath` atomically (rename replaces the target). Windows can't
 * replace an executable that is running, but it can rename it: move the old one aside first,
 * then clean it up (now, or at the next launch if it is still running).
 */
async function swapIntoPlace(staged: string, finalPath: string): Promise<void> {
  try {
    await rename(staged, finalPath);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!existsSync(finalPath) || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error;
  }
  const aside = `${finalPath}.old-${Date.now()}`;
  await rename(finalPath, aside);
  try {
    await rename(staged, finalPath);
  } catch (error) {
    await rename(aside, finalPath).catch(() => {});
    throw error;
  }
  await unlink(aside).catch(() => {});
}

/** Largest regular file under `rootDir` whose basename matches `pattern`. */
export async function findExecutable(rootDir: string, pattern: RegExp): Promise<string | null> {
  const best = { file: null as string | null, size: -1 };
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 4) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile() && pattern.test(entry.name)) {
        const size = statSync(full).size;
        if (size > best.size) Object.assign(best, { file: full, size });
      }
    }
  };
  await walk(rootDir, 0);
  return best.file;
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

/**
 * Singleton wrapper for use in the Electron main process. The renderer
 * never touches AssetManager directly — it sends IPC messages handled in
 * ipc/register.ts.
 */
let singleton: AssetManager | null = null;

export function getAssetManager(): AssetManager {
  if (!singleton) {
    singleton = new AssetManager({
      userDataDir: app.getPath("userData"),
      userAgent: `Chaturanga-Desktop/${app.getVersion()}`
    });
  }
  return singleton;
}
