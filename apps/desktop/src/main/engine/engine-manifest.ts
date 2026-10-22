/**
 * Where engine downloads come from.
 *
 * Stockfish and Lc0 are resolved at check/download time from the upstream
 * GitHub "latest release" (see ./github-releases.ts), so users always get the
 * newest official build without an app update. Each release source below lists,
 * per platform, which release asset to pick and how to find the executable
 * inside it (asset and file names embed the version, so both are patterns).
 * Integrity comes from the `digest` GitHub publishes for every release asset;
 * nothing is pinned here.
 *
 * ENGINE_MANIFEST is the offline FALLBACK: last known-good direct URLs, used
 * only when the GitHub API is unreachable or rate-limited and nothing is cached.
 * The Maia 3 model and Lc0's own network are not versioned releases, so they always
 * use their fixed URLs from this manifest.
 */

export type PlatformKey = "darwin-arm64" | "darwin-x64" | "linux-x64" | "win32-x64";

export const SUPPORTED_PLATFORMS: readonly PlatformKey[] = [
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "win32-x64"
];

export type ReleaseAssetId = "stockfish" | "lc0";

/** The network Lc0 plays with as an engine of its own. */
export const LC0_NETWORK_ID = "lc0-network";

/** Maia 3: one ONNX model for every rating, run in a hidden window (maia/maia-host.ts), not by Lc0. */
export const MAIA3_ID = "maia3";

/** Weight / model files: fixed downloads, nothing to extract or execute. */
export type WeightAssetId = typeof MAIA3_ID | typeof LC0_NETWORK_ID;

export type ArchiveKind = "tar" | "tar.gz" | "tar.xz" | "zip";

export type ManifestPlatformEntry = {
  url: string;
  /** Approximate size; only a progress hint until the server reports the real length. */
  sizeBytes: number;
  /**
   * Optional sha256 (hex), only for a URL whose content can't change (Maia 3's names a commit).
   * Fallback entries carry none; release assets use GitHub's digest.
   */
  sha256?: string;
  extract?: ArchiveKind;
  /**
   * Required when `extract` is set: regex source matched against file basenames inside the
   * extracted archive (the name embeds the version). The largest match wins.
   */
  executablePattern?: string;
};

export type EngineManifest = {
  schemaVersion: number;
  stockfish: { version: string; platforms: Record<PlatformKey, ManifestPlatformEntry> };
  lc0: {
    version: string;
    /** Upstream publishes Windows binaries only; other platforms install Lc0 themselves. */
    platforms: Partial<Record<PlatformKey, ManifestPlatformEntry>>;
    /** Shown when the platform has no entry above. */
    installInstructions: Record<PlatformKey, string>;
    homepageUrl: string;
  };
  /** The Maia 3 model (the same file on every platform). */
  maia3: {
    /** Label plus the upstream commit the file is pinned to, recorded as the installed version. */
    version: string;
    file: ManifestPlatformEntry;
  };
  /** The network the managed Lc0 engine plays with, unless the user picks their own file. */
  lc0Network: {
    /** The network's name, recorded as the installed version. */
    version: string;
    file: ManifestPlatformEntry;
  };
  licenses: {
    /** The app ships the same licence (GPL-3.0) text, so no copy is downloaded next to the model. */
    maia3: { authors: string; sourceUrl: string; license: string; noticeUrl: string };
    /** The networks page states no licence; only the source and its authors are recorded. */
    lc0Network: { authors: string; sourceUrl: string };
  };
};

/* ------------------------------------------------------------------ release sources */

/** CPU features a build may require (x86-64 only; detected at runtime, see ./cpu-features.ts). */
export type CpuFeature = "avx2" | "bmi2" | "sse41" | "popcnt";

type AssetCandidate = {
  /** Matched against the release asset `name`. */
  pattern: RegExp;
  extract: ArchiveKind;
  /** Skip this candidate unless the CPU is known to support all of these. */
  requires?: readonly CpuFeature[];
};

export type PlatformMatcher = {
  /** In order of preference; the first one present in the release (and runnable here) wins. */
  candidates: readonly AssetCandidate[];
  /** Regex source for the executable's basename inside the archive. */
  executablePattern: string;
};

export type ReleaseSource = {
  /** `owner/name` on GitHub. */
  repo: string;
  platforms: Partial<Record<PlatformKey, PlatformMatcher>>;
};

// Stockfish executables are named `stockfish` or `stockfish-<os>-<build>[.exe]`; the archives
// also carry docs (Copying.txt, wiki/*.md), which the pattern excludes; the largest match wins.
const STOCKFISH_EXECUTABLE = "^stockfish(?!.*\\.(md|txt|nnue)$)(-[a-z0-9_.-]+)?(\\.exe)?$";

// Since Stockfish 19 upstream ships one "universal" build per OS/arch that picks the best
// code path for the CPU at runtime (AVX2, AVX-512, ...), so it is always the first choice.
// The older per-ISA names follow as a fallback in case a future release goes back to them:
// AVX2 only when the CPU is known to have it (avx512 / vnni builds are never picked), then
// the SSE4.1+POPCNT build every x86-64 CPU from the last ~15 years runs, then plain x86-64.
// (`tar -xf` detects gzip/xz itself, so "tar" also covers a .tar.gz here.)
const legacyX64 = (os: string, extract: "tar" | "zip"): AssetCandidate[] => {
  const ext = extract === "zip" ? "zip" : "tar(\\.gz)?";
  const rx = (build: string) => new RegExp(`^stockfish-${os}-x86-64${build}\\.${ext}$`);
  return [
    { pattern: rx("-avx2"), extract, requires: ["avx2"] },
    { pattern: rx("-sse41-popcnt"), extract },
    { pattern: rx(""), extract }
  ];
};

export const STOCKFISH_SOURCE: ReleaseSource = {
  repo: "official-stockfish/Stockfish",
  platforms: {
    "darwin-arm64": {
      candidates: [
        { pattern: /^stockfish-macos-universal\.tar\.gz$/, extract: "tar.gz" },
        { pattern: /^stockfish-macos-universal\.tar$/, extract: "tar" },
        { pattern: /^stockfish-macos-m1-apple-silicon\.tar(\.gz)?$/, extract: "tar" }
      ],
      executablePattern: STOCKFISH_EXECUTABLE
    },
    "darwin-x64": {
      candidates: [
        { pattern: /^stockfish-macos-universal\.tar\.gz$/, extract: "tar.gz" },
        { pattern: /^stockfish-macos-universal\.tar$/, extract: "tar" },
        ...legacyX64("macos", "tar")
      ],
      executablePattern: STOCKFISH_EXECUTABLE
    },
    "linux-x64": {
      candidates: [
        { pattern: /^stockfish-linux-x86-64-universal\.tar\.gz$/, extract: "tar.gz" },
        { pattern: /^stockfish-linux-x86-64-universal\.tar$/, extract: "tar" },
        ...legacyX64("ubuntu", "tar")
      ],
      executablePattern: STOCKFISH_EXECUTABLE
    },
    "win32-x64": {
      candidates: [
        { pattern: /^stockfish-windows-x86-64-universal\.zip$/, extract: "zip" },
        ...legacyX64("windows", "zip")
      ],
      executablePattern: STOCKFISH_EXECUTABLE
    }
  }
};

// Lc0 publishes Windows builds only. The CPU (OpenBLAS) build runs everywhere without GPU
// drivers or DLL bundles; DNNL is the other CPU-only build. GPU builds are never picked.
export const LC0_SOURCE: ReleaseSource = {
  repo: "LeelaChessZero/lc0",
  platforms: {
    "win32-x64": {
      candidates: [
        { pattern: /^lc0-v[\w.-]+-windows-cpu-openblas\.zip$/, extract: "zip" },
        { pattern: /^lc0-v[\w.-]+-windows-cpu-dnnl\.zip$/, extract: "zip" }
      ],
      executablePattern: "^lc0\\.exe$"
    }
  }
};

export const RELEASE_SOURCES: Record<ReleaseAssetId, ReleaseSource> = {
  stockfish: STOCKFISH_SOURCE,
  lc0: LC0_SOURCE
};

/* ------------------------------------------------------------------ fallback manifest */

// Last known-good releases, used only when GitHub's API can't be reached. Sizes are exact for
// these URLs (from the release API) but only drive the initial progress estimate.
// Stockfish 19 — https://github.com/official-stockfish/Stockfish/releases/tag/sf_19
const SF_BASE = "https://github.com/official-stockfish/Stockfish/releases/download/sf_19";

// Lc0 0.32.1 — https://github.com/LeelaChessZero/lc0/releases/tag/v0.32.1 (Windows builds only).
const LC0_BASE = "https://github.com/LeelaChessZero/lc0/releases/download/v0.32.1";

// Maia 3 — CSSLab's own platform model (https://github.com/CSSLab/maia-platform-frontend),
// pinned to a commit so the file (and its sha256) can't change under us. Nothing to extract.
const MAIA3_COMMIT = "0013cc8e6ec52c88f5b3d694781d4cc8427cb91a";
const MAIA3_REPO_RAW = `https://raw.githubusercontent.com/CSSLab/maia-platform-frontend/${MAIA3_COMMIT}`;

// Lc0's network — LCZero's recommended small net (https://lczero.org/play/networks/bestnets/):
// T1-256x10-distilled-swa-2432500, a plain .pb.gz Lc0 reads directly. Runs on CPU or GPU.
const LC0_NETWORK_URL =
  "https://storage.lczero.org/files/networks-contrib/t1-256x10-distilled-swa-2432500.pb.gz";

export const ENGINE_MANIFEST = {
  schemaVersion: 2,
  stockfish: {
    version: "sf_19",
    platforms: {
      "darwin-arm64": {
        url: `${SF_BASE}/stockfish-macos-universal.tar.gz`,
        sizeBytes: 82_323_876,
        extract: "tar.gz",
        executablePattern: STOCKFISH_EXECUTABLE
      },
      "darwin-x64": {
        url: `${SF_BASE}/stockfish-macos-universal.tar.gz`,
        sizeBytes: 82_323_876,
        extract: "tar.gz",
        executablePattern: STOCKFISH_EXECUTABLE
      },
      "linux-x64": {
        url: `${SF_BASE}/stockfish-linux-x86-64-universal.tar.gz`,
        sizeBytes: 81_388_977,
        extract: "tar.gz",
        executablePattern: STOCKFISH_EXECUTABLE
      },
      "win32-x64": {
        url: `${SF_BASE}/stockfish-windows-x86-64-universal.zip`,
        sizeBytes: 81_431_614,
        extract: "zip",
        executablePattern: STOCKFISH_EXECUTABLE
      }
    }
  },
  lc0: {
    version: "v0.32.1",
    platforms: {
      "win32-x64": {
        url: `${LC0_BASE}/lc0-v0.32.1-windows-cpu-openblas.zip`,
        sizeBytes: 23_818_982,
        extract: "zip",
        executablePattern: "^lc0\\.exe$"
      }
    },
    installInstructions: {
      "darwin-arm64": "brew install lc0",
      "darwin-x64": "brew install lc0",
      "linux-x64":
        "Install via your package manager (e.g. apt-based: build from https://lczero.org/play/download/), or build from source: https://github.com/LeelaChessZero/lc0#building",
      "win32-x64": "Auto-download available"
    },
    homepageUrl: "https://lczero.org/play/download/"
  },
  maia3: {
    version: `maia3_simplified@${MAIA3_COMMIT.slice(0, 7)}`,
    file: {
      url: `${MAIA3_REPO_RAW}/public/maia3/maia3_simplified.onnx`,
      // Exact size from the URL's Content-Length. The URL names a commit, so the content is
      // fixed and its hash is pinned (unlike the fallback entries, which follow releases).
      sizeBytes: 45_683_686,
      sha256: "405bf76c15727dad8728b352c06a8f3c1b80fb2760e8d666b32485c63d75b856"
    }
  },
  lc0Network: {
    version: "T1-256x10-distilled-swa-2432500",
    // Exact size from the URL's Content-Length.
    file: { url: LC0_NETWORK_URL, sizeBytes: 37_118_673 }
  },
  licenses: {
    maia3: {
      authors: "CSSLab (University of Toronto / McGill)",
      sourceUrl: "https://github.com/CSSLab/maia-platform-frontend",
      license: "GPL-3.0",
      noticeUrl: `${MAIA3_REPO_RAW}/LICENSE`
    },
    lc0Network: {
      authors: "Leela Chess Zero project",
      sourceUrl: "https://lczero.org/play/networks/bestnets/"
    }
  }
} as const satisfies EngineManifest;

/** The manifest key for this machine, or null on an unsupported OS. */
export function currentPlatformKey(
  platform: string = process.platform,
  arch: string = process.arch
): PlatformKey | null {
  if (platform === "darwin") return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
  if (platform === "linux") return arch === "x64" ? "linux-x64" : null;
  if (platform === "win32") return arch === "x64" ? "win32-x64" : null;
  return null;
}

/** The fallback download entry for an asset on a platform; null when it has to be installed manually. */
export function resolveManifestEntry(
  manifest: EngineManifest,
  id: ReleaseAssetId | WeightAssetId,
  platformKey: PlatformKey | null
): ManifestPlatformEntry | null {
  if (id === "stockfish") return platformKey ? manifest.stockfish.platforms[platformKey] : null;
  if (id === "lc0") return platformKey ? (manifest.lc0.platforms[platformKey] ?? null) : null;
  return weightEntry(manifest, id);
}

/** A weight / model file's download (the same on every platform). */
export function weightEntry(manifest: EngineManifest, id: WeightAssetId): ManifestPlatformEntry {
  return id === LC0_NETWORK_ID ? manifest.lc0Network.file : manifest.maia3.file;
}

/**
 * Version string of the fallback entry: a release tag for engines, the network's name for Lc0's,
 * the pinned commit for Maia 3.
 */
export function manifestVersionFor(
  manifest: EngineManifest,
  id: ReleaseAssetId | WeightAssetId
): string {
  if (id === "stockfish") return manifest.stockfish.version;
  if (id === "lc0") return manifest.lc0.version;
  if (id === LC0_NETWORK_ID) return manifest.lc0Network.version;
  return manifest.maia3.version;
}

/**
 * Comparable form of a version or release tag: `sf_17.1` → `17.1`, `v0.32.1` → `0.32.1`.
 * Older installs recorded the bare version (`17.1`), newer ones the tag (`sf_19`).
 */
export function normalizeVersion(version: string): string {
  return version.trim().replace(/^[^\d]*/, "");
}

/** True when `latest` names a different release than `installed`. */
export function isDifferentVersion(
  installed: string | null | undefined,
  latest: string | null | undefined
): boolean {
  if (!installed || !latest) return false;
  return normalizeVersion(installed) !== normalizeVersion(latest);
}

/* ------------------------------------------------------------------ asset selection */

/** The subset of a GitHub release asset we rely on. */
export type ReleaseAssetInfo = {
  name: string;
  size: number;
  browser_download_url: string;
  /** `sha256:<hex>`; null/absent on assets uploaded before GitHub started computing digests. */
  digest?: string | null;
};

export type SelectedAsset = {
  asset: ReleaseAssetInfo;
  extract: ArchiveKind;
  executablePattern: string;
};

/**
 * Picks the release asset for a platform: the first candidate (in preference order) that the
 * release contains and the CPU can run. `cpuFeatures` null means "unknown" — candidates that
 * require specific features are then skipped in favour of a more compatible build.
 */
export function selectReleaseAsset(
  assets: readonly ReleaseAssetInfo[],
  matcher: PlatformMatcher | undefined,
  cpuFeatures: ReadonlySet<CpuFeature> | null
): SelectedAsset | null {
  if (!matcher) return null;
  for (const candidate of matcher.candidates) {
    if (candidate.requires && !candidate.requires.every((feature) => cpuFeatures?.has(feature)))
      continue;
    const asset = assets.find((a) => candidate.pattern.test(a.name));
    if (asset)
      return { asset, extract: candidate.extract, executablePattern: matcher.executablePattern };
  }
  return null;
}
