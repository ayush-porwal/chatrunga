import type {
  AssetProgressEvent,
  EngineAssetId,
  EngineAssetStatus,
  EngineAssetStatusMap
} from "@chaturanga/shared/ipc/chaturanga-api";

/**
 * The downloadable engine assets (engines + Maia networks), in display order. Versions and
 * sizes come from `assets.status()` — the latest GitHub release, not hard-coded here.
 */
export const ENGINE_ASSETS: readonly { id: EngineAssetId; label: string }[] = [
  { id: "stockfish", label: "Stockfish" },
  { id: "lc0", label: "Lc0" },
  { id: "maia-1100", label: "Maia 1100" },
  { id: "maia-1300", label: "Maia 1300" },
  { id: "maia-1500", label: "Maia 1500" },
  { id: "maia-1700", label: "Maia 1700" },
  { id: "maia-1900", label: "Maia 1900" }
];

export function isAssetInstalled(status: Pick<EngineAssetStatus, "state"> | undefined): boolean {
  return status?.state === "installed" || status?.state === "custom";
}

/** Installed state + latest known release per asset (no network call); null outside the desktop app. */
export async function fetchAssetStatus(): Promise<EngineAssetStatusMap | null> {
  return (await window.chaturanga?.assets.status()) ?? null;
}

/** What "Download missing" fetches: missing assets that have a download on this platform. */
export function missingDownloads(status: EngineAssetStatusMap | null): EngineAssetStatus[] {
  if (!status) return [];
  return ENGINE_ASSETS.map((asset) => status[asset.id]).filter(
    (entry): entry is EngineAssetStatus => entry?.state === "missing" && entry.autoDownload
  );
}

/** `24 MB` (never below 1 MB); null when the size is unknown. */
export function formatSize(bytes: number | null | undefined): string | null {
  return bytes ? `${Math.max(1, Math.round(bytes / 1_000_000))} MB` : null;
}

/* ------------------------------------------------------------------ download progress */

type AssetStatus = "pending" | "downloading" | "verifying" | "installing" | "ready" | "error";

export type AssetProgress = {
  bytesReceived: number;
  bytesTotal: number;
  status: AssetStatus;
  errorMessage?: string;
};

export type AssetProgressMap = Partial<Record<EngineAssetId, AssetProgress>>;

/** "Queued" entries for `assets`, sized from the release each would download. */
export function initialAssetProgress(assets: readonly EngineAssetStatus[]): AssetProgressMap {
  return Object.fromEntries(
    assets.map((asset) => [asset.id, { bytesReceived: 0, bytesTotal: asset.downloadSizeBytes ?? 0, status: "pending" }])
  );
}

/** Folds one asset-manager progress event into the per-asset progress map. */
export function applyAssetProgress(progress: AssetProgressMap, event: AssetProgressEvent): AssetProgressMap {
  const current = progress[event.assetId] ?? { bytesReceived: 0, bytesTotal: 0, status: "pending" };
  const next: AssetProgress =
    event.type === "download"
      ? { ...current, status: "downloading", bytesReceived: event.bytesReceived, bytesTotal: event.bytesTotal }
      : event.type === "verify"
        ? { ...current, status: "verifying" }
        : event.type === "install"
          ? { ...current, status: "installing" }
          : event.type === "ready"
            ? { ...current, status: "ready", bytesReceived: current.bytesTotal }
            : { ...current, status: "error", errorMessage: event.message };
  return { ...progress, [event.assetId]: next };
}

/** Whole-number download percentage (0 before the size is known). */
export function progressPercent(progress: AssetProgress | undefined): number {
  return progress?.bytesTotal ? Math.round((progress.bytesReceived / progress.bytesTotal) * 100) : 0;
}

/* ------------------------------------------------------------------ first-run setup */

/**
 * What the welcome recommends: Stockfish (scores every move) and the Maia networks (what players
 * of each rating would play), where they are missing and downloadable here. Maia networks only run
 * inside Lc0, so a missing Lc0 comes along with them; where Lc0 has no download, Maia is left out
 * (its networks would sit unused). Lc0 on its own is optional and left to Settings.
 */
export function recommendedDownloads(status: EngineAssetStatusMap | null): EngineAssetStatus[] {
  if (!status) return [];
  const missing = missingDownloads(status);
  const maiaInstalled = ENGINE_ASSETS.some((asset) => asset.id.startsWith("maia-") && isAssetInstalled(status[asset.id]));
  const maiaMissing = missing.some((asset) => asset.id.startsWith("maia-"));
  const lc0Runs = isAssetInstalled(status.lc0);
  const lc0Download = missing.find((asset) => asset.id === "lc0");
  const withMaia = lc0Runs || Boolean(lc0Download);
  return missing.filter((asset) =>
    asset.id === "lc0" ? maiaMissing || maiaInstalled : asset.id.startsWith("maia-") ? withMaia : true
  );
}

/** One line of the setup list: Stockfish on its own, the Maia networks (and the Lc0 they run in) together. */
export type SetupRow = {
  key: "stockfish" | "lc0" | "maia";
  label: string;
  ids: EngineAssetId[];
  bytesReceived: number;
  bytesTotal: number;
  status: AssetStatus;
};

const ROW_STATUS_ORDER: readonly AssetStatus[] = ["error", "downloading", "verifying", "installing", "pending", "ready"];

/**
 * Groups queued assets into setup rows with combined progress. A row's status is its most
 * pressing member's: any failure, then any work in progress, then waiting; ready only when all are.
 * Verifying / installing / ready members count as fully downloaded.
 */
export function setupRows(assets: readonly EngineAssetStatus[], progress: AssetProgressMap): SetupRow[] {
  const rows: SetupRow[] = [];
  const byKey = new Map<SetupRow["key"], SetupRow>();
  const hasMaia = assets.some((asset) => asset.id.startsWith("maia-"));
  for (const asset of assets) {
    const key: SetupRow["key"] =
      asset.id.startsWith("maia-") || (asset.id === "lc0" && hasMaia) ? "maia" : (asset.id as "stockfish" | "lc0");
    let row = byKey.get(key);
    if (!row) {
      row = { key, label: key === "maia" ? "Maia" : asset.id === "lc0" ? "Lc0" : "Stockfish", ids: [], bytesReceived: 0, bytesTotal: 0, status: "ready" };
      byKey.set(key, row);
      rows.push(row);
    }
    const entry = progress[asset.id];
    const total = entry?.bytesTotal || asset.downloadSizeBytes || 0;
    const status = entry?.status ?? "pending";
    const done = status === "verifying" || status === "installing" || status === "ready";
    row.ids.push(asset.id);
    row.bytesTotal += total;
    row.bytesReceived += done ? total : status === "error" ? 0 : (entry?.bytesReceived ?? 0);
    if (ROW_STATUS_ORDER.indexOf(status) < ROW_STATUS_ORDER.indexOf(row.status)) row.status = status;
  }
  for (const row of rows) {
    if (row.key !== "maia") continue;
    const ratings = row.ids.filter((id) => id.startsWith("maia-")).map((id) => id.replace("maia-", ""));
    row.label = ratings.length > 1 ? `Maia ${ratings[0]}–${ratings[ratings.length - 1]}` : `Maia ${ratings[0]}`;
  }
  return rows;
}

/** Whole-number percentage of a setup row (0 before sizes are known). */
export function setupRowPercent(row: Pick<SetupRow, "bytesReceived" | "bytesTotal">): number {
  return row.bytesTotal ? Math.min(100, Math.round((row.bytesReceived / row.bytesTotal) * 100)) : 0;
}
