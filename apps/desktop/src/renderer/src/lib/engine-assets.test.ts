import { describe, expect, it } from "vitest";
import type { EngineAssetId, EngineAssetStatus, EngineAssetStatusMap } from "@chaturanga/shared/ipc/chaturanga-api";
import {
  ENGINE_ASSETS,
  applyAssetProgress,
  formatSize,
  initialAssetProgress,
  isAssetInstalled,
  missingDownloads,
  progressPercent
} from "./engine-assets";

function status(id: EngineAssetId, patch: Partial<EngineAssetStatus> = {}): EngineAssetStatus {
  return {
    id,
    state: "missing",
    installedPath: null,
    customPath: null,
    sizeBytes: 0,
    installedAt: null,
    installedVersion: null,
    latestVersion: "sf_19",
    updateAvailable: false,
    downloadSizeBytes: 25_000_000,
    latestSource: "github",
    autoDownload: true,
    installInstructions: null,
    checkedAt: null,
    checkError: null,
    ...patch
  };
}

function statusMap(patches: Partial<Record<EngineAssetId, Partial<EngineAssetStatus>>>): EngineAssetStatusMap {
  return Object.fromEntries(ENGINE_ASSETS.map(({ id }) => [id, status(id, patches[id])])) as EngineAssetStatusMap;
}

describe("engine assets", () => {
  it("counts installed and custom assets as installed", () => {
    expect(isAssetInstalled(status("stockfish", { state: "installed" }))).toBe(true);
    expect(isAssetInstalled(status("stockfish", { state: "custom" }))).toBe(true);
    expect(isAssetInstalled(status("stockfish"))).toBe(false);
    expect(isAssetInstalled(undefined)).toBe(false);
  });

  it("lists only missing assets that can be downloaded on this platform", () => {
    const map = statusMap({ stockfish: { state: "installed" }, lc0: { autoDownload: false } });
    expect(missingDownloads(map).map((entry) => entry.id)).toEqual([
      "maia-1100",
      "maia-1300",
      "maia-1500",
      "maia-1700",
      "maia-1900"
    ]);
    expect(missingDownloads(null)).toEqual([]);
  });

  it("formats sizes in whole megabytes", () => {
    expect(formatSize(24_400_000)).toBe("24 MB");
    expect(formatSize(1_000)).toBe("1 MB");
    expect(formatSize(null)).toBeNull();
    expect(formatSize(0)).toBeNull();
  });

  it("folds download progress events into per-asset state", () => {
    let progress = initialAssetProgress([status("stockfish"), status("lc0", { downloadSizeBytes: null })]);
    expect(progress.stockfish).toMatchObject({ status: "pending", bytesReceived: 0, bytesTotal: 25_000_000 });
    expect(progress.lc0).toMatchObject({ bytesTotal: 0 });
    expect(progressPercent(progress.lc0)).toBe(0);

    progress = applyAssetProgress(progress, { type: "download", assetId: "stockfish", bytesReceived: 10, bytesTotal: 40 });
    expect(progress.stockfish).toMatchObject({ status: "downloading", bytesReceived: 10, bytesTotal: 40 });
    expect(progressPercent(progress.stockfish)).toBe(25);

    progress = applyAssetProgress(progress, { type: "verify", assetId: "stockfish" });
    expect(progress.stockfish?.status).toBe("verifying");
    progress = applyAssetProgress(progress, { type: "install", assetId: "stockfish" });
    expect(progress.stockfish?.status).toBe("installing");
    progress = applyAssetProgress(progress, { type: "ready", assetId: "stockfish" });
    expect(progress.stockfish).toMatchObject({ status: "ready", bytesReceived: 40 });

    progress = applyAssetProgress(progress, { type: "error", assetId: "lc0", message: "offline" });
    expect(progress.lc0).toMatchObject({ status: "error", errorMessage: "offline" });
  });
});
