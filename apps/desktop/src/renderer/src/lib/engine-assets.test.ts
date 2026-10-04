import { describe, expect, it } from "vitest";
import type {
  EngineAssetId,
  EngineAssetStatus,
  EngineAssetStatusMap
} from "@chaturanga/shared/ipc/chaturanga-api";
import {
  ENGINE_ASSETS,
  applyAssetProgress,
  formatSize,
  initialAssetProgress,
  isAssetInstalled,
  maiaNeedsLc0,
  missingDownloads,
  progressPercent,
  recommendedDownloads,
  setupRowPercent,
  setupRows
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

function statusMap(
  patches: Partial<Record<EngineAssetId, Partial<EngineAssetStatus>>>
): EngineAssetStatusMap {
  return Object.fromEntries(
    ENGINE_ASSETS.map(({ id }) => [id, status(id, patches[id])])
  ) as EngineAssetStatusMap;
}

describe("engine assets", () => {
  it("counts installed and custom assets as installed", () => {
    expect(isAssetInstalled(status("stockfish", { state: "installed" }))).toBe(true);
    expect(isAssetInstalled(status("stockfish", { state: "custom" }))).toBe(true);
    expect(isAssetInstalled(status("stockfish"))).toBe(false);
    expect(isAssetInstalled(undefined)).toBe(false);
  });

  it("says Maia needs Lc0 only when a Maia network is installed and Lc0 isn't", () => {
    expect(maiaNeedsLc0(statusMap({ "maia-1500": { state: "installed" } }))).toBe(true);
    expect(
      maiaNeedsLc0(statusMap({ "maia-1500": { state: "installed" }, lc0: { state: "custom" } }))
    ).toBe(false);
    expect(maiaNeedsLc0(statusMap({ stockfish: { state: "installed" } }))).toBe(false);
    expect(maiaNeedsLc0(null)).toBe(false);
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
    let progress = initialAssetProgress([
      status("stockfish"),
      status("lc0", { downloadSizeBytes: null })
    ]);
    expect(progress.stockfish).toMatchObject({
      status: "pending",
      bytesReceived: 0,
      bytesTotal: 25_000_000
    });
    expect(progress.lc0).toMatchObject({ bytesTotal: 0 });
    expect(progressPercent(progress.lc0)).toBe(0);

    progress = applyAssetProgress(progress, {
      type: "download",
      assetId: "stockfish",
      bytesReceived: 10,
      bytesTotal: 40
    });
    expect(progress.stockfish).toMatchObject({
      status: "downloading",
      bytesReceived: 10,
      bytesTotal: 40
    });
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

describe("first-run setup", () => {
  it("recommends missing Stockfish and Maia, with the Lc0 that Maia runs in", () => {
    const map = statusMap({ "maia-1900": { state: "installed" }, lc0: { autoDownload: true } });
    expect(recommendedDownloads(map).map((asset) => asset.id)).toEqual([
      "stockfish",
      "lc0",
      "maia-1100",
      "maia-1300",
      "maia-1500",
      "maia-1700"
    ]);
    expect(recommendedDownloads(null)).toEqual([]);
  });

  it("leaves Lc0 out when it is installed or nothing needs it", () => {
    const installed = statusMap({ lc0: { state: "installed" } });
    expect(recommendedDownloads(installed).map((asset) => asset.id)).toEqual([
      "stockfish",
      "maia-1100",
      "maia-1300",
      "maia-1500",
      "maia-1700",
      "maia-1900"
    ]);
    const noMaia = statusMap({
      "maia-1100": { autoDownload: false },
      "maia-1300": { autoDownload: false },
      "maia-1500": { autoDownload: false },
      "maia-1700": { autoDownload: false },
      "maia-1900": { autoDownload: false }
    });
    expect(recommendedDownloads(noMaia).map((asset) => asset.id)).toEqual(["stockfish"]);
  });

  it("skips Maia where Lc0 has no download, and fetches Lc0 alone for installed networks", () => {
    const noLc0 = statusMap({ lc0: { autoDownload: false } });
    expect(recommendedDownloads(noLc0).map((asset) => asset.id)).toEqual(["stockfish"]);
    const networksOnly = statusMap({
      stockfish: { state: "installed" },
      "maia-1100": { state: "installed" },
      "maia-1300": { state: "installed" },
      "maia-1500": { state: "installed" },
      "maia-1700": { state: "installed" },
      "maia-1900": { state: "installed" }
    });
    expect(recommendedDownloads(networksOnly).map((asset) => asset.id)).toEqual(["lc0"]);
  });

  it("counts Lc0 in the Maia row it is downloaded for", () => {
    const rows = setupRows(
      [
        status("lc0", { downloadSizeBytes: 30_000_000 }),
        status("maia-1100", { downloadSizeBytes: 1_000_000 }),
        status("maia-1900", { downloadSizeBytes: 1_000_000 })
      ],
      {}
    );
    expect(rows.map((row) => [row.key, row.label, row.ids])).toEqual([
      ["maia", "Maia 1100–1900 + Lc0", ["lc0", "maia-1100", "maia-1900"]]
    ]);
    expect(rows[0].bytesTotal).toBe(32_000_000);
    expect(setupRows([status("lc0")], {}).map((row) => [row.key, row.label])).toEqual([
      ["lc0", "Lc0"]
    ]);
  });

  it("groups Maia networks into one row with combined progress", () => {
    const queued = [
      status("stockfish", { downloadSizeBytes: 80_000_000 }),
      status("maia-1100", { downloadSizeBytes: 1_000_000 }),
      status("maia-1900", { downloadSizeBytes: 1_000_000 })
    ];
    const rows = setupRows(queued, {
      stockfish: { bytesReceived: 20_000_000, bytesTotal: 80_000_000, status: "downloading" },
      "maia-1100": { bytesReceived: 400_000, bytesTotal: 1_000_000, status: "installing" }
    });
    expect(rows.map((row) => [row.key, row.label, row.status])).toEqual([
      ["stockfish", "Stockfish", "downloading"],
      ["maia", "Maia 1100–1900", "installing"]
    ]);
    expect(setupRowPercent(rows[0])).toBe(25);
    // The installing network counts as downloaded; the other hasn't started.
    expect(rows[1].bytesReceived).toBe(1_000_000);
    expect(setupRowPercent(rows[1])).toBe(50);
  });

  it("shows a failure over progress, and ready only when every member is ready", () => {
    const queued = [status("maia-1100"), status("maia-1300")];
    expect(
      setupRows(queued, {
        "maia-1100": { bytesReceived: 5, bytesTotal: 5, status: "ready" },
        "maia-1300": { bytesReceived: 0, bytesTotal: 5, status: "error", errorMessage: "x" }
      })[0].status
    ).toBe("error");
    expect(
      setupRows(queued, { "maia-1100": { bytesReceived: 5, bytesTotal: 5, status: "ready" } })[0]
        .status
    ).toBe("pending");
    expect(
      setupRows(queued, {
        "maia-1100": { bytesReceived: 5, bytesTotal: 5, status: "ready" },
        "maia-1300": { bytesReceived: 5, bytesTotal: 5, status: "ready" }
      })[0].status
    ).toBe("ready");
  });
});
