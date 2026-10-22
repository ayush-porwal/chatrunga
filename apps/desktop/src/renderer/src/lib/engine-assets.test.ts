import { describe, expect, it } from "vitest";
import type {
  EngineAssetId,
  EngineAssetStatus,
  EngineAssetStatusMap
} from "@chaturanga/shared/ipc/chaturanga-api";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import {
  ENGINE_ASSETS,
  applyAssetProgress,
  engineListRows,
  formatSize,
  initialAssetProgress,
  isAssetInstalled,
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

  it("lists only missing assets that can be downloaded on this platform", () => {
    const map = statusMap({ stockfish: { state: "installed" }, lc0: { autoDownload: false } });
    expect(missingDownloads(map).map((entry) => entry.id)).toStrictEqual(["lc0-network", "maia3"]);
    expect(missingDownloads(null)).toStrictEqual([]);
  });

  it("formats sizes to a tenth of a megabyte below 100 MB, whole above", () => {
    expect(formatSize(45_683_686)).toBe("45.7 MB");
    expect(formatSize(24_400_000)).toBe("24.4 MB");
    expect(formatSize(104_900_000)).toBe("105 MB");
    expect(formatSize(1_000)).toBe("0.1 MB");
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

function engine(id: string, name: string, patch: Partial<EngineConfig> = {}): EngineConfig {
  return {
    id,
    name,
    executablePath: `/engines/${id}`,
    workingDirectory: null,
    weightsPath: null,
    imagePath: null,
    args: [],
    protocol: "uci",
    runtime: "custom-uci",
    isAvailable: true,
    isDefault: false,
    createdAt: 0,
    updatedAt: 0,
    ...patch
  };
}

type EngineListRow = ReturnType<typeof engineListRows>[number];

/** A row's download id, or its engine's id for a user's own engine. */
function rowId(row: EngineListRow): string {
  return row.kind === "asset" ? row.id : row.engine.id;
}

/** The engine joined to download `id`'s row (null: none installed; undefined: no such row). */
function assetEngine(rows: readonly EngineListRow[], id: EngineAssetId) {
  return rows.find((row) => row.kind === "asset" && row.id === id)?.engine;
}

describe("Settings engines list", () => {
  it("lists Stockfish, Lc0 and its network, Maia 3, then the user's engines, joining managed engines to their downloads", () => {
    const stockfish = engine("sf", "Stockfish (managed)");
    const lc0 = engine("lc0", "Lc0 (managed)");
    const maia = engine("maia", "Maia (managed)", { runtime: "maia3", isHumanPrediction: true });
    const own = engine("own", "Komodo");
    const rows = engineListRows(statusMap({}), [own, maia, lc0, stockfish]);
    expect(rows.map(rowId)).toStrictEqual(["stockfish", "lc0", "lc0-network", "maia3", "own"]);
    expect(assetEngine(rows, "stockfish")).toBe(stockfish);
    expect(assetEngine(rows, "lc0")).toBe(lc0);
    expect(assetEngine(rows, "lc0-network")).toBeNull();
    expect(assetEngine(rows, "maia3")).toBe(maia);
    expect(assetEngine(engineListRows(statusMap({}), [stockfish]), "maia3")).toBeNull();
  });

  it("lists a managed engine with no matching download as a plain engine", () => {
    const stray = engine("x", "Maia 1500 (managed)");
    const rows = engineListRows(statusMap({}), [stray]);
    expect(rows.at(-1)).toStrictEqual({ kind: "engine", engine: stray });
  });

  it("lists only the engines without download status", () => {
    const stockfish = engine("sf", "Stockfish (managed)");
    expect(engineListRows(null, [stockfish])).toStrictEqual([
      { kind: "engine", engine: stockfish }
    ]);
  });
});

describe("first-run setup", () => {
  it("recommends missing Stockfish, Lc0 with its network, and Maia 3", () => {
    const map = statusMap({ lc0: { autoDownload: true } });
    expect(recommendedDownloads(map).map((asset) => asset.id)).toStrictEqual([
      "stockfish",
      "lc0",
      "lc0-network",
      "maia3"
    ]);
    expect(recommendedDownloads(null)).toStrictEqual([]);
  });

  it("brings Lc0's network along for an Lc0 that is already set up", () => {
    const installed = statusMap({
      lc0: { state: "custom", autoDownload: false },
      maia3: { state: "installed" }
    });
    expect(recommendedDownloads(installed).map((asset) => asset.id)).toStrictEqual([
      "stockfish",
      "lc0-network"
    ]);
  });

  it("recommends Maia 3 without Lc0, skips Lc0's network where Lc0 has no download, and fetches Lc0 alone for an installed network", () => {
    const noLc0 = statusMap({ lc0: { autoDownload: false } });
    expect(recommendedDownloads(noLc0).map((asset) => asset.id)).toStrictEqual([
      "stockfish",
      "maia3"
    ]);
    const networkOnly = statusMap({
      stockfish: { state: "installed" },
      "lc0-network": { state: "installed" },
      maia3: { state: "installed" }
    });
    expect(recommendedDownloads(networkOnly).map((asset) => asset.id)).toStrictEqual(["lc0"]);
  });

  it("lists Lc0 with its network in a row of their own, apart from Maia 3", () => {
    const rows = setupRows(
      [
        status("lc0", { downloadSizeBytes: 24_000_000 }),
        status("lc0-network", { downloadSizeBytes: 37_000_000 }),
        status("maia3", { downloadSizeBytes: 45_700_000 })
      ],
      {}
    );
    expect(rows.map((row) => [row.key, row.label, row.ids, row.bytesTotal])).toStrictEqual([
      ["lc0", "Lc0", ["lc0", "lc0-network"], 61_000_000],
      ["maia", "Maia 3", ["maia3"], 45_700_000]
    ]);
    // A failed binary marks the Lc0 row, not Maia's.
    const failed = setupRows([status("lc0"), status("lc0-network"), status("maia3")], {
      lc0: { bytesReceived: 0, bytesTotal: 5, status: "error", errorMessage: "offline" }
    });
    expect(failed.map((row) => [row.key, row.status])).toStrictEqual([
      ["lc0", "error"],
      ["maia", "pending"]
    ]);
  });

  it("combines a row's members' progress", () => {
    const queued = [
      status("stockfish", { downloadSizeBytes: 80_000_000 }),
      status("lc0", { downloadSizeBytes: 1_000_000 }),
      status("lc0-network", { downloadSizeBytes: 1_000_000 })
    ];
    const rows = setupRows(queued, {
      stockfish: { bytesReceived: 20_000_000, bytesTotal: 80_000_000, status: "downloading" },
      lc0: { bytesReceived: 400_000, bytesTotal: 1_000_000, status: "installing" }
    });
    expect(rows.map((row) => [row.key, row.label, row.status])).toStrictEqual([
      ["stockfish", "Stockfish", "downloading"],
      ["lc0", "Lc0", "installing"]
    ]);
    expect(setupRowPercent(rows[0])).toBe(25);
    // The installing binary counts as downloaded; the network hasn't started.
    expect(rows[1].bytesReceived).toBe(1_000_000);
    expect(setupRowPercent(rows[1])).toBe(50);
  });

  it("keeps the failed member's error message on its row", () => {
    const queued = [status("lc0"), status("lc0-network")];
    expect(
      setupRows(queued, {
        lc0: { bytesReceived: 5, bytesTotal: 5, status: "ready" },
        "lc0-network": {
          bytesReceived: 0,
          bytesTotal: 5,
          status: "error",
          errorMessage: "fetch failed"
        }
      })[0].errorMessage
    ).toBe("fetch failed");
  });

  it("shows a failure over progress, and ready only when every member is ready", () => {
    const queued = [status("lc0"), status("lc0-network")];
    expect(
      setupRows(queued, {
        lc0: { bytesReceived: 5, bytesTotal: 5, status: "ready" },
        "lc0-network": { bytesReceived: 0, bytesTotal: 5, status: "error", errorMessage: "x" }
      })[0].status
    ).toBe("error");
    expect(
      setupRows(queued, { lc0: { bytesReceived: 5, bytesTotal: 5, status: "ready" } })[0].status
    ).toBe("pending");
    expect(
      setupRows(queued, {
        lc0: { bytesReceived: 5, bytesTotal: 5, status: "ready" },
        "lc0-network": { bytesReceived: 5, bytesTotal: 5, status: "ready" }
      })[0].status
    ).toBe("ready");
  });
});
