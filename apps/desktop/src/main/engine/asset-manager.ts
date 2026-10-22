import { app } from "electron";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EventEmitter } from "node:events";
import { logger } from "../logger";
import { cpuFeatures as detectCpuFeatures } from "./cpu-features";
import {
  ENGINE_MANIFEST,
  LC0_NETWORK_ID,
  MAIA3_ID,
  RELEASE_SOURCES,
  currentPlatformKey,
  isDifferentVersion,
  manifestVersionFor,
  resolveManifestEntry,
  selectReleaseAsset,
  weightEntry,
  type ArchiveKind,
  type CpuFeature,
  type EngineManifest,
  type PlatformKey,
  type ReleaseAssetId,
  type SelectedAsset,
  type WeightAssetId
} from "./engine-manifest";
import {
  LC0_NETWORK_DOWNLOAD_HOSTS,
  RAW_DOWNLOAD_HOSTS,
  RELEASE_CACHE_TTL_MS,
  RELEASE_DOWNLOAD_HOSTS,
  ReleaseCache,
  isAllowedDownloadUrl,
  isReleaseDownloadOf,
  parseSha256Digest,
  type CachedRelease,
  type FetchLike
} from "./github-releases";
import { downloadToFile } from "./http-download";
import { isOneOf } from "@chaturanga/shared/types/guards";
import { parseStoredJson } from "../stored-json";
import { errorCode } from "../system-error";
import type { StoredRetiredRecord } from "./retired-maia";

const exec = promisify(execFile);

/**
 * Asset manager — installs Stockfish, Lc0, Lc0's network and the Maia 3 model and tracks them
 * across launches.
 *
 * Where downloads come from (see ./engine-manifest.ts):
 * - Stockfish / Lc0: the upstream GitHub "latest release", resolved via the REST API and
 *   cached (./github-releases.ts). The release asset for this platform is picked by pattern;
 *   its `size` drives progress, its `digest` (sha256) is verified, its tag is the installed
 *   version. When GitHub can't be reached and nothing is cached, the bundled fallback
 *   manifest (last known-good URLs) is used.
 * - Maia 3 (`maia3`): CSSLab's ONNX model, a fixed raw.githubusercontent.com URL pinned to a
 *   commit, with a pinned sha256. Always the managed file: no custom path.
 * - Lc0's network (`lc0-network`): LCZero's recommended small net, a fixed storage.lczero.org
 *   URL. A plain data file like Maia 3's, so it is its own asset with the same pipeline; the user
 *   can point it at their own `.pb` / `.pb.gz` instead (a "custom" path, as for the engines).
 *
 * Maia 1 (five Lc0 weight files, `maia-1100` … `maia-1900`) is retired: init() deletes their files
 * and forgets their records, never a file the user chose as their own (retired-maia.ts).
 *
 * Install pipeline: download (resumable, host allow-listed) → verify (sha256 digest when
 * published, and the server-reported length) → extract into a staging dir → chmod (engine
 * binaries only) / clear quarantine → atomic rename over the installed file. The install path
 * never changes, so an update keeps the engines table pointing at the same file. Nothing downloaded is executed
 * here. One retry on failure (a digest mismatch discards the partial first).
 *
 * Updates are never applied silently: status() reports `updateAvailable` (a newer GitHub release,
 * or a Maia 3 model other than the one this build pins) and the user triggers downloadAsset()
 * again.
 *
 * State lives in JSON at `userData/engine-assets.json` (release cache next to it).
 */

const STATE_FILE = "engine-assets.json";
const RELEASE_CACHE_FILE = "engine-releases-cache.json";
/** An explicit "check for updates" reuses a lookup this recent instead of asking GitHub again. */
const CHECK_MAX_AGE_MS = 60 * 1000;

export type AssetId = "stockfish" | "lc0" | "lc0-network" | "maia3";

type AssetState = "missing" | "installed" | "custom";

/** Where a download (or install) came from. */
type AssetSource = "github" | "fallback" | "fixed";

export type AssetRecord = {
  id: AssetId;
  state: AssetState;
  /** Local path to the installed binary or weight file. */
  installedPath: string | null;
  /** The user's own file, chosen in Settings → Engines. */
  customPath: string | null;
  /** sha256 of the installed file. */
  sha256: string | null;
  /**
   * Installed version: the release tag for engines (`sf_19`), the pinned commit for Maia 3, the
   * network's name for Lc0's. Older state files recorded a bare version (`17.1`) here; compare
   * with normalizeVersion().
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

export const ALL_ASSET_IDS: readonly AssetId[] = ["stockfish", "lc0", "lc0-network", "maia3"];

export function isAssetId(value: unknown): value is AssetId {
  return isOneOf(ALL_ASSET_IDS, value);
}

/** A value for every asset (written out, so the compiler checks that none is missing). */
function forEveryAsset<V>(value: (id: AssetId) => V): Record<AssetId, V> {
  return {
    stockfish: value("stockfish"),
    lc0: value("lc0"),
    "lc0-network": value("lc0-network"),
    maia3: value("maia3")
  };
}

/** {@link forEveryAsset} for values that take a while, all at once. */
async function forEveryAssetAsync<V>(
  value: (id: AssetId) => Promise<V>
): Promise<Record<AssetId, V>> {
  const [stockfish, lc0, lc0Network, maia3] = await Promise.all([
    value("stockfish"),
    value("lc0"),
    value("lc0-network"),
    value("maia3")
  ]);
  return { stockfish, lc0, "lc0-network": lc0Network, maia3 };
}

function isReleaseAsset(id: AssetId): id is ReleaseAssetId {
  return id === "stockfish" || id === "lc0";
}

/** Hosts a download of `id` (and each redirect) may come from; Maia 3 is a raw repository file. */
function downloadHostsFor(id: AssetId): readonly string[] {
  if (isReleaseAsset(id)) return RELEASE_DOWNLOAD_HOSTS;
  return id === LC0_NETWORK_ID ? LC0_NETWORK_DOWNLOAD_HOSTS : RAW_DOWNLOAD_HOSTS;
}

/**
 * Why `file` can't be Lc0's network, or null: it must be a `.pb` / `.pb.gz` network, and not a
 * Maia one (Maia is set up from its own rows; as Lc0's network it would make Lc0 look and count
 * as a Maia engine, which is told apart by "maia" in the weights file's name).
 */
function customNetworkProblem(file: string): string | null {
  const name = path.basename(file);
  if (!/\.pb(\.gz)?$/i.test(name)) return "Choose an Lc0 network file (.pb or .pb.gz).";
  if (/maia/i.test(name)) return "That's a Maia network. Maia is set up from its own rows.";
  return null;
}

/** A concrete download: what to fetch, how to check it, and how to install it. */
export type ResolvedDownload = {
  id: AssetId;
  url: string;
  sizeBytes: number;
  /** Expected sha256 (hex); null when upstream publishes none (fallback / Lc0's network). */
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

function installedVersionOf(record: AssetRecord): string | null {
  return record.version ?? record.manifestVersion ?? null;
}

/** An asset a download can fetch: what is installed, and the version a download would bring. */
function downloadableStatus(record: AssetRecord, resolved: ResolvedDownload): AssetStatus {
  const installedVersion = installedVersionOf(record);
  return {
    ...record,
    installedVersion,
    latestVersion: resolved.version,
    // Only a live (or cached) GitHub answer can say there is something newer: the
    // fallback manifest may well be older than what is installed. A pinned file (Maia 3's model,
    // its URL a commit and its sha256 fixed) is this build's choice: any other version installed
    // is replaced by it.
    updateAvailable:
      record.state === "installed" &&
      (resolved.source === "github" || (resolved.source === "fixed" && resolved.sha256 !== null)) &&
      isDifferentVersion(installedVersion, resolved.version),
    downloadSizeBytes: resolved.sizeBytes,
    latestSource: resolved.source,
    autoDownload: true,
    installInstructions: null,
    checkedAt: resolved.checkedAt ? new Date(resolved.checkedAt).toISOString() : null,
    checkError: resolved.checkError
  };
}

/** An asset this platform must install by hand (Lc0 on macOS / Linux). */
function manualInstallStatus(record: AssetRecord, installInstructions: string | null): AssetStatus {
  return {
    ...record,
    installedVersion: installedVersionOf(record),
    latestVersion: null,
    updateAvailable: false,
    downloadSizeBytes: null,
    latestSource: null,
    autoDownload: false,
    installInstructions,
    checkedAt: null,
    checkError: null
  };
}

/** The GitHub release asset picked for this platform. */
function releaseDownload(
  id: ReleaseAssetId,
  cached: CachedRelease,
  selected: SelectedAsset,
  checkError: string | null
): ResolvedDownload {
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
    checkError
  };
}

class DigestMismatchError extends Error {
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
  /**
   * Maia 1 records an older build marked `custom` at a name the retirement deletes: the file is the
   * user's, so it stays, and so does its record (written back with the state; see retired-maia.ts).
   */
  private retiredCustom: StoredRetiredRecord[] = [];

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
    await import("./retired-maia")
      .then(({ removeRetiredMaia }) => removeRetiredMaia(this.enginesDir, this.retiredCustom))
      .catch((error: unknown) => {
        logger.warn(
          "asset-manager",
          "removing the retired Maia 1 weights failed:",
          errorText(error)
        );
      });
  }

  getInstalled(): Record<AssetId, AssetRecord> {
    return forEveryAsset((id) => this.state.get(id) ?? this.emptyRecord(id));
  }

  /**
   * Installed state plus the latest upstream version / download size per asset. Without
   * `refresh` no network request is made (cached release or fallback manifest); with it,
   * GitHub is asked unless a lookup happened in the last minute.
   */
  async getStatus(opts: { refresh?: boolean } = {}): Promise<Record<AssetId, AssetStatus>> {
    const lookup = opts.refresh ? { maxAgeMs: CHECK_MAX_AGE_MS } : ("cache-only" as const);
    const installed = this.getInstalled();
    return forEveryAssetAsync(async (id): Promise<AssetStatus> => {
      const resolved = await this.resolveDownload(id, lookup).catch(() => null);
      return resolved
        ? downloadableStatus(installed[id], resolved)
        : manualInstallStatus(installed[id], this.installInstructionsFor(id));
    });
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
    await Promise.all(
      repos.map((repo) => this.releases.get(repo, { maxAgeMs: RELEASE_CACHE_TTL_MS }))
    );
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
    if (!isReleaseAsset(id)) return this.weightDownload(id);

    const source = RELEASE_SOURCES[id];
    const matcher = this.platformKey ? source.platforms[this.platformKey] : undefined;
    if (!matcher) return null;

    const cached =
      lookup === "cache-only"
        ? await this.releases.peek(source.repo)
        : await this.releases.get(source.repo, lookup);
    let checkError = this.releases.lastError(source.repo);
    if (cached) {
      const selected = selectReleaseAsset(cached.release.assets, matcher, await this.cpuFeatures());
      if (selected && isReleaseDownloadOf(selected.asset.browser_download_url, source.repo)) {
        return releaseDownload(id, cached, selected, cached.stale ? checkError : null);
      }
      checkError = `No ${this.platformKey} build found in ${source.repo} ${cached.release.tag_name}`;
      logger.warn("asset-manager", `${checkError}; using the bundled fallback`);
    }
    return this.fallbackDownload(id, cached?.fetchedAt ?? null, checkError);
  }

  /** A weight / model file (Maia 3, Lc0's network): the manifest's fixed file, not a release asset. */
  private weightDownload(id: WeightAssetId): ResolvedDownload {
    const entry = weightEntry(this.manifest, id);
    return {
      id,
      url: entry.url,
      sizeBytes: entry.sizeBytes,
      sha256: entry.sha256 ?? null,
      extract: null,
      executablePattern: null,
      version: manifestVersionFor(this.manifest, id),
      source: "fixed",
      assetName: path.posix.basename(new URL(entry.url).pathname),
      checkedAt: null,
      checkError: null
    };
  }

  /** The bundled manifest's build for this platform, when GitHub gave none; null: manual install. */
  private fallbackDownload(
    id: ReleaseAssetId,
    checkedAt: number | null,
    checkError: string | null
  ): ResolvedDownload | null {
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
      checkedAt,
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
    const hosts = downloadHostsFor(id);
    if (!isAllowedDownloadUrl(resolved.url, hosts)) throw new DisallowedDownloadError(resolved.url);

    // Partials are keyed by upstream version + file name, so a resumed download can never
    // splice bytes from two different releases together.
    const downloadsDir = path.join(this.enginesDir, ".downloads");
    await mkdir(downloadsDir, { recursive: true });
    const partialPath = path.join(
      downloadsDir,
      `${id}--${safeName(resolved.version)}--${safeName(resolved.assetName)}.partial`
    );

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
      if (error instanceof Error && error.name === "DisallowedUrlError")
        throw new DisallowedDownloadError(resolved.url);
      throw error;
    });

    this.emit("progress", { type: "verify", assetId: id });
    if (resolved.sha256) {
      const actual = await sha256File(partialPath);
      if (actual !== resolved.sha256) {
        await unlink(partialPath).catch(() => undefined);
        throw new DigestMismatchError(id);
      }
    } else {
      logger.info(
        "asset-manager",
        `${id}: no upstream digest (${resolved.source}); verified by length only`
      );
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
        await unlink(partialPath).catch(() => undefined);
      } else {
        staged = path.join(stagingDir, path.basename(finalPath));
        await rename(partialPath, staged);
      }
      if (isReleaseAsset(id)) await this.applyExecPermissions(staged);
      await this.stripQuarantine(staged);
      await swapIntoPlace(staged, finalPath);
    } finally {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async extractArchive(
    archivePath: string,
    destDir: string,
    kind: ArchiveKind
  ): Promise<void> {
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
    const running = new Set<Promise<void>>();
    while (queue.length > 0 || running.size > 0) {
      while (running.size < concurrency && queue.length > 0) {
        const id = queue.shift()!;
        const promise = this.downloadAsset(id)
          .then(() => {
            succeeded.push(id);
          })
          .catch((err: unknown) => {
            failed.push({ id, reason: errorText(err) });
          })
          .finally(() => {
            running.delete(promise);
          });
        running.add(promise);
      }
      if (running.size > 0) await Promise.race([...running].map((p) => p.catch(() => undefined)));
    }
    return { succeeded, failed };
  }

  async removeAsset(id: AssetId): Promise<void> {
    const record = this.state.get(id);
    // Only delete files we installed; a custom path is the user's own file.
    if (record?.installedPath && record.state !== "custom") {
      await unlink(record.installedPath).catch(() => undefined);
    }
    this.state.delete(id);
    await this.saveState();
    this.emit("statusChanged");
  }

  async setCustomPath(id: AssetId, customPath: string): Promise<void> {
    if (id === MAIA3_ID)
      throw new Error(`${id} is managed by the app and can't use your own file.`);
    if (!existsSync(customPath)) throw new Error(`Custom path does not exist: ${customPath}`);
    const problem = id === LC0_NETWORK_ID ? customNetworkProblem(customPath) : null;
    if (problem) throw new Error(problem);
    const sha256 = await sha256File(customPath);
    const sizeBytes = statSync(customPath).size;
    const previous = this.state.get(id);
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
    // The download it replaces would otherwise stay on disk for good: removing a custom asset
    // never deletes (the file is the user's). Best effort: a running engine may hold it (Windows).
    if (previous?.state === "installed" && previous.installedPath)
      await this.deleteOwnFile(previous.installedPath, customPath);
    this.emit("statusChanged");
  }

  /** Deletes a file this manager installed (inside the engines folder), never `keep`. */
  private async deleteOwnFile(file: string, keep: string): Promise<void> {
    const relative = path.relative(this.enginesDir, path.resolve(file));
    const inside = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
    if (!inside || path.resolve(file) === path.resolve(keep)) return;
    await unlink(file).catch(() => undefined);
  }

  private releaseReposForPlatform(): string[] {
    const key = this.platformKey;
    if (!key) return [];
    return Object.values(RELEASE_SOURCES)
      .filter((source) => source.platforms[key])
      .map((source) => source.repo);
  }

  private installInstructionsFor(id: AssetId): string | null {
    if (id === "lc0" && this.platformKey)
      return this.manifest.lc0.installInstructions[this.platformKey];
    return null;
  }

  private manualInstallMessage(id: AssetId): string {
    // Lc0 is the known case: upstream publishes no macOS / Linux binaries.
    const instruction = this.installInstructionsFor(id);
    if (instruction) {
      return `Lc0 doesn't ship Mac/Linux binaries on GitHub. Install it yourself: ${instruction}. Then choose the lc0 binary in Settings → Engines.`;
    }
    return `No download available for ${id} on ${process.platform}-${process.arch}.`;
  }

  private fileNameFor(id: AssetId): string {
    if (id === "stockfish") return process.platform === "win32" ? "stockfish.exe" : "stockfish";
    if (id === "lc0") return process.platform === "win32" ? "lc0.exe" : "lc0";
    if (id === MAIA3_ID) return "maia3_simplified.onnx";
    return `${id}.pb.gz`;
  }

  /** Engine binaries only: weight and model files are never made executable. */
  private async applyExecPermissions(filePath: string): Promise<void> {
    if (process.platform === "win32") return;
    await chmod(filePath, 0o755);
  }

  /**
   * macOS quarantine strip, so the verified binary runs without Gatekeeper's first-run
   * dialog (the app itself is signed/notarized, or accepted as unsigned in alpha).
   * Windows: PowerShell Unblock-File clears Mark-of-the-Web. Linux: no-op.
   */
  private async stripQuarantine(filePath: string): Promise<void> {
    if (process.platform === "darwin") {
      await exec("xattr", ["-d", "com.apple.quarantine", filePath]).catch(() => undefined);
      return;
    }
    if (process.platform === "win32") {
      const literal = filePath.replaceAll("'", "''");
      await exec("powershell.exe", [
        "-NoProfile",
        "-Command",
        `Unblock-File -LiteralPath '${literal}'`
      ]).catch(() => undefined);
    }
  }

  /** Staging dirs and swapped-out binaries left by an interrupted install / a running engine. */
  private async cleanupLeftovers(): Promise<void> {
    const entries = await readdir(this.enginesDir).catch(() => [] as string[]);
    await Promise.all(
      entries
        .filter((name) => name.startsWith(".staging-") || /\.old-\d+$/.test(name))
        .map((name) =>
          rm(path.join(this.enginesDir, name), { recursive: true, force: true }).catch(
            () => undefined
          )
        )
    );
  }

  private async loadState(): Promise<void> {
    if (!existsSync(this.statePath)) return;
    try {
      const raw = await readFile(this.statePath, "utf-8");
      // A damaged file may hold null entries.
      const parsed = parseStoredJson<{ records?: (AssetRecord | null)[] }>(raw);
      let changed = false;
      const unknown: StoredRetiredRecord[] = [];
      for (const record of parsed.records ?? []) {
        if (!isAssetId(record?.id)) {
          // Not one of today's assets: Maia 1's (retired-maia.ts sorts them) or junk.
          if (record) unknown.push(record);
          continue;
        }
        const restored = this.withExistingFiles(record);
        changed ||= restored !== record;
        this.state.set(record.id, restored);
      }
      if (unknown.length > 0) {
        const { sortRetiredRecords } = await import("./retired-maia");
        const retired = sortRetiredRecords(unknown, this.enginesDir);
        this.retiredCustom = retired.kept;
        changed ||= retired.forgot;
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
      const payload = { records: [...this.state.values(), ...this.retiredCustom] };
      const tmp = `${this.statePath}.${process.pid}.${++this.stateWriteSeq}.tmp`;
      await writeFile(tmp, JSON.stringify(payload, null, 2), "utf-8");
      await rename(tmp, this.statePath);
    };
    const next = this.stateWrites.then(write, write);
    this.stateWrites = next.catch(() => undefined);
    return next;
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

class DisallowedDownloadError extends Error {
  constructor(url: string) {
    let host = "an invalid URL";
    try {
      host = new URL(url).host;
    } catch {
      // keep the placeholder
    }
    super(`Refusing to download from ${host}: only the known download hosts are allowed`);
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
    const code = errorCode(error);
    if (!existsSync(finalPath) || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES"))
      throw error;
  }
  const aside = `${finalPath}.old-${Date.now()}`;
  await rename(finalPath, aside);
  try {
    await rename(staged, finalPath);
  } catch (error) {
    await rename(aside, finalPath).catch(() => undefined);
    throw error;
  }
  await unlink(aside).catch(() => undefined);
}

/** Largest regular file under `rootDir` whose basename matches `pattern`. */
async function findExecutable(rootDir: string, pattern: RegExp): Promise<string | null> {
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
