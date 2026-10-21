import { describe, expect, it } from "vitest";
import sf19 from "./__fixtures__/github/stockfish-latest-sf_19.json";
import sf171 from "./__fixtures__/github/stockfish-sf_17.1.json";
import lc0Latest from "./__fixtures__/github/lc0-latest-v0.32.1.json";
import {
  LC0_NETWORK_DOWNLOAD_HOSTS,
  RAW_DOWNLOAD_HOSTS,
  isAllowedDownloadUrl
} from "./github-releases";
import {
  ENGINE_MANIFEST,
  LC0_NETWORK_ID,
  LC0_SOURCE,
  MAIA3_ID,
  STOCKFISH_SOURCE,
  SUPPORTED_PLATFORMS,
  currentPlatformKey,
  isDifferentVersion,
  manifestVersionFor,
  normalizeVersion,
  resolveManifestEntry,
  selectReleaseAsset,
  type CpuFeature,
  type ManifestPlatformEntry,
  type PlatformKey,
  type ReleaseAssetInfo
} from "./engine-manifest";

function expectValidEntry(entry: ManifestPlatformEntry | undefined, label: string): void {
  expect(entry, label).toBeDefined();
  const { url, sizeBytes, sha256, extract, executablePattern } = entry!;
  const parsed = new URL(url);
  expect(parsed.protocol, `${label} url`).toBe("https:");
  expect(["github.com", "raw.githubusercontent.com"], `${label} host`).toContain(parsed.hostname);
  expect(Number.isInteger(sizeBytes) && sizeBytes > 0, `${label} sizeBytes`).toBe(true);
  // Optional fields are checked when an entry has them (archives have extract and a pattern).
  // oxlint-disable-next-line vitest/no-conditional-expect -- sha256 is optional per entry
  if (sha256 !== undefined) expect(sha256, `${label} sha256`).toMatch(/^[0-9a-f]{64}$/);
  if (extract !== undefined) {
    // oxlint-disable-next-line vitest/no-conditional-expect -- only archives name an extract format
    expect(["tar", "tar.gz", "tar.xz", "zip"], `${label} extract`).toContain(extract);
    // oxlint-disable-next-line vitest/no-conditional-expect -- only archives carry a pattern
    expect(() => new RegExp(executablePattern!), `${label} executablePattern`).not.toThrow();
  }
}

/**
 * How a platform gets Lc0: a download (checked as a valid entry), install instructions, or none.
 */
function lc0Provision(platform: PlatformKey): "download" | "instructions" | "none" {
  const entry = resolveManifestEntry(ENGINE_MANIFEST, "lc0", platform);
  if (entry) {
    expectValidEntry(entry, `lc0 ${platform}`);
    return "download";
  }
  return ENGINE_MANIFEST.lc0.installInstructions[platform].trim().length > 0
    ? "instructions"
    : "none";
}

const AVX2: ReadonlySet<CpuFeature> = new Set(["avx2", "bmi2", "sse41", "popcnt"]);
const NO_AVX2: ReadonlySet<CpuFeature> = new Set(["sse41", "popcnt"]);

const pick = (
  release: { assets: readonly ReleaseAssetInfo[] },
  platform: PlatformKey,
  cpu: ReadonlySet<CpuFeature> | null = null
) =>
  selectReleaseAsset(release.assets, STOCKFISH_SOURCE.platforms[platform], cpu)?.asset.name ?? null;

describe("Stockfish release asset selection", () => {
  it("picks the universal build of the latest release (sf_19 fixture) on every platform", () => {
    expect(pick(sf19, "darwin-arm64")).toBe("stockfish-macos-universal.tar.gz");
    expect(pick(sf19, "darwin-x64")).toBe("stockfish-macos-universal.tar.gz");
    expect(pick(sf19, "linux-x64")).toBe("stockfish-linux-x86-64-universal.tar.gz");
    expect(pick(sf19, "win32-x64")).toBe("stockfish-windows-x86-64-universal.zip");
    // Universal builds dispatch at runtime: CPU features don't change the choice.
    expect(pick(sf19, "linux-x64", NO_AVX2)).toBe("stockfish-linux-x86-64-universal.tar.gz");
  });

  it("exposes the asset's size, digest and extraction info", () => {
    const selected = selectReleaseAsset(
      sf19.assets,
      STOCKFISH_SOURCE.platforms["darwin-arm64"],
      null
    )!;
    expect(selected.asset.size).toBe(82_323_876);
    expect(selected.asset.digest).toBe(
      "sha256:a1f0e3bcc5a6927a11fe6fc8e54a779754645f3c2bae2cf13420fd1957adaa77"
    );
    expect(selected.extract).toBe("tar.gz");
    expect(new RegExp(selected.executablePattern, "i").test("stockfish-macos-universal")).toBe(
      true
    );
  });

  it("falls back to per-ISA builds for releases without universal builds (sf_17.1 fixture)", () => {
    expect(pick(sf171, "darwin-arm64")).toBe("stockfish-macos-m1-apple-silicon.tar");
    // AVX2 only when the CPU is known to support it; otherwise the SSE4.1 build.
    expect(pick(sf171, "linux-x64", AVX2)).toBe("stockfish-ubuntu-x86-64-avx2.tar");
    expect(pick(sf171, "linux-x64", NO_AVX2)).toBe("stockfish-ubuntu-x86-64-sse41-popcnt.tar");
    expect(pick(sf171, "linux-x64", null)).toBe("stockfish-ubuntu-x86-64-sse41-popcnt.tar");
    expect(pick(sf171, "win32-x64", AVX2)).toBe("stockfish-windows-x86-64-avx2.zip");
    expect(pick(sf171, "win32-x64", null)).toBe("stockfish-windows-x86-64-sse41-popcnt.zip");
    expect(pick(sf171, "darwin-x64", AVX2)).toBe("stockfish-macos-x86-64-avx2.tar");
    // Never an avx512 / vnni build.
    for (const platform of SUPPORTED_PLATFORMS) {
      expect(String(pick(sf171, platform, AVX2))).not.toMatch(/avx512|vnni/);
    }
  });

  it("returns null when no asset matches", () => {
    expect(pick({ assets: [] }, "linux-x64")).toBeNull();
    expect(selectReleaseAsset(sf19.assets, undefined, null)).toBeNull();
  });

  it("matches the executable inside the archive, not the docs", () => {
    const rx = new RegExp(STOCKFISH_SOURCE.platforms["linux-x64"]!.executablePattern, "i");
    for (const name of [
      "stockfish",
      "stockfish-linux-x86-64-universal",
      "stockfish-windows-x86-64-universal.exe",
      "stockfish-macos-m1-apple-silicon"
    ]) {
      expect(rx.test(name), name).toBe(true);
    }
    for (const name of [
      "Copying.txt",
      "stockfish-readme.md",
      "stockfish-notes.txt",
      "Top CPU Contributors.txt",
      "AUTHORS"
    ]) {
      expect(rx.test(name), name).toBe(false);
    }
  });
});

describe("Lc0 release asset selection", () => {
  it("picks the Windows CPU (OpenBLAS) build and nothing elsewhere", () => {
    const win = selectReleaseAsset(lc0Latest.assets, LC0_SOURCE.platforms["win32-x64"], null);
    expect(win?.asset.name).toBe("lc0-v0.32.1-windows-cpu-openblas.zip");
    expect(win?.asset.size).toBe(23_818_982);
    expect(new RegExp(win!.executablePattern, "i").test("lc0.exe")).toBe(true);
    for (const platform of ["darwin-arm64", "darwin-x64", "linux-x64"] as const) {
      expect(selectReleaseAsset(lc0Latest.assets, LC0_SOURCE.platforms[platform], null)).toBeNull();
    }
  });

  it("uses the DNNL CPU build when OpenBLAS is missing", () => {
    const assets = lc0Latest.assets.filter((a) => !a.name.includes("openblas"));
    expect(selectReleaseAsset(assets, LC0_SOURCE.platforms["win32-x64"], null)?.asset.name).toBe(
      "lc0-v0.32.1-windows-cpu-dnnl.zip"
    );
  });
});

describe("bundled fallback manifest", () => {
  it("has the expected versions and shape", () => {
    expect(ENGINE_MANIFEST.schemaVersion).toBe(2);
    expect(ENGINE_MANIFEST.stockfish.version).toBe("sf_19");
    expect(ENGINE_MANIFEST.lc0.version).toBe("v0.32.1");
    expect(ENGINE_MANIFEST.maia3.version).toBe("maia3_simplified@0013cc8");
  });

  it("matches the recorded release: same asset URLs and sizes as the selection", () => {
    for (const platform of SUPPORTED_PLATFORMS) {
      const entry = ENGINE_MANIFEST.stockfish.platforms[platform];
      expectValidEntry(entry, `stockfish ${platform}`);
      const selected = selectReleaseAsset(sf19.assets, STOCKFISH_SOURCE.platforms[platform], null)!;
      expect(entry.url, platform).toBe(selected.asset.browser_download_url);
      expect(entry.sizeBytes, platform).toBe(selected.asset.size);
    }
    const lc0 = ENGINE_MANIFEST.lc0.platforms["win32-x64"];
    const lc0Selected = selectReleaseAsset(
      lc0Latest.assets,
      LC0_SOURCE.platforms["win32-x64"],
      null
    )!;
    expect(lc0.url).toBe(lc0Selected.asset.browser_download_url);
    expect(lc0.sizeBytes).toBe(lc0Selected.asset.size);
  });

  it("pins no hash for files that follow upstream releases or names", () => {
    const entries = [
      ...Object.values(ENGINE_MANIFEST.stockfish.platforms),
      ...Object.values(ENGINE_MANIFEST.lc0.platforms),
      ENGINE_MANIFEST.lc0Network.file
    ] as ManifestPlatformEntry[];
    for (const entry of entries) expect(entry.sha256).toBeUndefined();
  });

  it.each(SUPPORTED_PLATFORMS)("has a Lc0 download or install instruction for %s", (platform) => {
    expect(lc0Provision(platform)).not.toBe("none");
  });

  it("has a Lc0 download for Windows and install instructions for macOS", () => {
    expect(resolveManifestEntry(ENGINE_MANIFEST, "lc0", "win32-x64")).not.toBeNull();
    expect(resolveManifestEntry(ENGINE_MANIFEST, "lc0", "darwin-arm64")).toBeNull();
  });

  it("has the Maia 3 model as a commit-pinned raw GitHub file with its exact size and hash, on every platform", () => {
    const commit = "0013cc8e6ec52c88f5b3d694781d4cc8427cb91a";
    for (const platform of [...SUPPORTED_PLATFORMS, null]) {
      expect(
        resolveManifestEntry(ENGINE_MANIFEST, MAIA3_ID, platform),
        String(platform)
      ).toStrictEqual({
        url: `https://raw.githubusercontent.com/CSSLab/maia-platform-frontend/${commit}/public/maia3/maia3_simplified.onnx`,
        sizeBytes: 45_683_686,
        sha256: "405bf76c15727dad8728b352c06a8f3c1b80fb2760e8d666b32485c63d75b856"
      });
    }
    expectValidEntry(ENGINE_MANIFEST.maia3.file, "maia3");
    expect(isAllowedDownloadUrl(ENGINE_MANIFEST.maia3.file.url, RAW_DOWNLOAD_HOSTS)).toBe(true);
    expect(ENGINE_MANIFEST.licenses.maia3).toStrictEqual({
      authors: "CSSLab (University of Toronto / McGill)",
      sourceUrl: "https://github.com/CSSLab/maia-platform-frontend",
      license: "GPL-3.0",
      noticeUrl: `https://raw.githubusercontent.com/CSSLab/maia-platform-frontend/${commit}/LICENSE`
    });
  });

  it("has Lc0's recommended small network as a plain file from LCZero's storage, on every platform", () => {
    for (const platform of [...SUPPORTED_PLATFORMS, null]) {
      const entry = resolveManifestEntry(ENGINE_MANIFEST, LC0_NETWORK_ID, platform);
      expect(entry).toStrictEqual({
        url: "https://storage.lczero.org/files/networks-contrib/t1-256x10-distilled-swa-2432500.pb.gz",
        sizeBytes: 37_118_673
      });
    }
    // The only host its download may use.
    expect(LC0_NETWORK_DOWNLOAD_HOSTS).toStrictEqual([
      new URL(ENGINE_MANIFEST.lc0Network.file.url).hostname
    ]);
    expect(ENGINE_MANIFEST.licenses.lc0Network.authors).toBe("Leela Chess Zero project");
  });

  it("maps assets to their fallback version", () => {
    expect(manifestVersionFor(ENGINE_MANIFEST, "stockfish")).toBe("sf_19");
    expect(manifestVersionFor(ENGINE_MANIFEST, "lc0")).toBe("v0.32.1");
    expect(manifestVersionFor(ENGINE_MANIFEST, MAIA3_ID)).toBe("maia3_simplified@0013cc8");
    expect(manifestVersionFor(ENGINE_MANIFEST, LC0_NETWORK_ID)).toBe(
      "T1-256x10-distilled-swa-2432500"
    );
  });

  it("maps the running platform to a manifest key", () => {
    expect(currentPlatformKey("darwin", "arm64")).toBe("darwin-arm64");
    expect(currentPlatformKey("darwin", "x64")).toBe("darwin-x64");
    expect(currentPlatformKey("linux", "x64")).toBe("linux-x64");
    expect(currentPlatformKey("win32", "x64")).toBe("win32-x64");
    expect(currentPlatformKey("linux", "arm64")).toBeNull();
    expect(currentPlatformKey("freebsd", "x64")).toBeNull();
    expect(resolveManifestEntry(ENGINE_MANIFEST, "stockfish", null)).toBeNull();
  });
});

describe("version comparison", () => {
  it("normalizes tags and bare versions", () => {
    expect(normalizeVersion("sf_17.1")).toBe("17.1");
    expect(normalizeVersion("v0.32.1")).toBe("0.32.1");
    expect(normalizeVersion("17.1")).toBe("17.1");
  });

  it("detects a different release, treating legacy bare versions as equal to their tag", () => {
    expect(isDifferentVersion("17.1", "sf_19")).toBe(true);
    expect(isDifferentVersion("0.31.2", "v0.32.1")).toBe(true);
    expect(isDifferentVersion("17.1", "sf_17.1")).toBe(false);
    expect(isDifferentVersion("sf_19", "sf_19")).toBe(false);
    expect(isDifferentVersion(null, "sf_19")).toBe(false);
    expect(isDifferentVersion("sf_19", null)).toBe(false);
  });
});
