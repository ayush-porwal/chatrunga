import type {
  AssetProgressEvent,
  EngineAssetId,
  EngineAssetStatus,
  EngineAssetStatusMap
} from "@chaturanga/shared/ipc/chaturanga-api";
import { MANAGED_ENGINE_SUFFIX } from "@chaturanga/shared/engine/managed";
import type { EngineConfig } from "@chaturanga/shared/types/engine";

/**
 * The downloadable engine assets (engines, Lc0's network, Maia networks), in display order.
 * Versions and sizes come from `assets.status()` — the latest GitHub release, not hard-coded here.
 */
export const ENGINE_ASSETS: readonly { id: EngineAssetId; label: string }[] = [
  { id: "stockfish", label: "Stockfish" },
  { id: "lc0", label: "Lc0" },
  { id: "lc0-network", label: "Lc0 network" },
  { id: "maia-1100", label: "Maia 1100" },
  { id: "maia-1300", label: "Maia 1300" },
  { id: "maia-1500", label: "Maia 1500" },
  { id: "maia-1700", label: "Maia 1700" },
  { id: "maia-1900", label: "Maia 1900" }
];

export function isAssetInstalled(status: Pick<EngineAssetStatus, "state"> | undefined): boolean {
  return status?.state === "installed" || status?.state === "custom";
}

/**
 * Maia networks are installed but can't run: Maia runs inside Lc0, which isn't set up (macOS and
 * Linux have no Lc0 download, so the user installs it and points the app at it).
 */
export function maiaNeedsLc0(status: EngineAssetStatusMap | null): boolean {
  if (!status || isAssetInstalled(status.lc0)) return false;
  return ENGINE_ASSETS.some(
    (asset) => asset.id.startsWith("maia-") && isAssetInstalled(status[asset.id])
  );
}

/**
 * Lc0 isn't set up and this computer has no Lc0 download (macOS, Linux): Maia can only run once
 * the user installs Lc0 and adds it in Settings → Engines, so the setup doesn't offer it.
 */
export function lc0NeedsManualInstall(status: EngineAssetStatusMap | null): boolean {
  if (!status) return false;
  return !isAssetInstalled(status.lc0) && !status.lc0.autoDownload;
}

/** Installed state + latest known release per asset (no network call); null outside the desktop app. */
export async function fetchAssetStatus(): Promise<EngineAssetStatusMap | null> {
  return (await window.chaturanga?.assets.status()) ?? null;
}

/** What "Download missing" fetches: missing assets that have a download on this platform. */
export function missingDownloads(status: EngineAssetStatusMap | null): EngineAssetStatus[] {
  if (!status) return [];
  return ENGINE_ASSETS.map((asset) => status[asset.id]).filter(
    (entry) => entry.state === "missing" && entry.autoDownload
  );
}

/** `24 MB` (never below 1 MB); null when the size is unknown. */
export function formatSize(bytes: number | null | undefined): string | null {
  return bytes ? `${Math.max(1, Math.round(bytes / 1_000_000))} MB` : null;
}

/* ------------------------------------------------------------------ Settings → Engines list */

/** One row of Settings → Engines: a managed download, or an engine the user added. */
export type EngineListRow =
  | {
      kind: "asset";
      id: EngineAssetId;
      label: string;
      status: EngineAssetStatus;
      /**
       * The "(managed)" engine the app keeps for this download (it is what gets picked and
       * tested); null until the download is usable (Lc0's needs its network too), and always for
       * Lc0's network, which Lc0's engine plays with.
       */
      engine: EngineConfig | null;
    }
  | { kind: "engine"; engine: EngineConfig };

/**
 * Settings → Engines, in order: Stockfish, Lc0 and its network (Lc0 also runs Maia), the Maia
 * networks, then the engines the user added. A managed engine joins its download's row by name,
 * as the registry sync names it; one with no known download (unexpected) is listed as a plain
 * engine. Without the download status (web preview, still loading) the list is just the engines.
 */
export function engineListRows(
  status: EngineAssetStatusMap | null,
  engines: readonly EngineConfig[]
): EngineListRow[] {
  if (!status) return engines.map((engine) => ({ kind: "engine", engine }));
  const assetRows: EngineListRow[] = [];
  const joined = new Set<string>();
  for (const asset of ENGINE_ASSETS) {
    const managedName = `${asset.label} ${MANAGED_ENGINE_SUFFIX}`;
    const engine =
      asset.id === "lc0-network"
        ? null
        : (engines.find((item) => item.name === managedName) ?? null);
    if (engine) joined.add(engine.id);
    assetRows.push({
      kind: "asset",
      id: asset.id,
      label: asset.label,
      status: status[asset.id],
      engine
    });
  }
  return [
    ...assetRows,
    ...engines
      .filter((engine) => !joined.has(engine.id))
      .map((engine): EngineListRow => ({ kind: "engine", engine }))
  ];
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
    assets.map((asset) => [
      asset.id,
      { bytesReceived: 0, bytesTotal: asset.downloadSizeBytes ?? 0, status: "pending" }
    ])
  );
}

/** Folds one asset-manager progress event into the per-asset progress map. */
export function applyAssetProgress(
  progress: AssetProgressMap,
  event: AssetProgressEvent
): AssetProgressMap {
  const current = progress[event.assetId] ?? { bytesReceived: 0, bytesTotal: 0, status: "pending" };
  const next: AssetProgress =
    event.type === "download"
      ? {
          ...current,
          status: "downloading",
          bytesReceived: event.bytesReceived,
          bytesTotal: event.bytesTotal
        }
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
  return progress?.bytesTotal
    ? Math.round((progress.bytesReceived / progress.bytesTotal) * 100)
    : 0;
}

/* ------------------------------------------------------------------ first-run setup */

/**
 * What the welcome recommends, where missing and downloadable here: Stockfish (scores every move),
 * Lc0 with its network (a neural-network engine), and the Maia networks (what players of each
 * rating would play). Lc0's network and Maia only run inside Lc0, so they come along only when Lc0
 * runs or is downloaded too; where Lc0 has no download and isn't set up, they are left out (they
 * would sit unused until the user installs Lc0; Settings → Engines still offers them).
 */
export function recommendedDownloads(status: EngineAssetStatusMap | null): EngineAssetStatus[] {
  if (!status) return [];
  const missing = missingDownloads(status);
  const withLc0 = isAssetInstalled(status.lc0) || missing.some((asset) => asset.id === "lc0");
  return missing.filter((asset) => asset.id === "stockfish" || asset.id === "lc0" || withLc0);
}

/** One line of the setup list: Stockfish, Lc0 with its network, the Maia networks. */
export type SetupRow = {
  key: "stockfish" | "lc0" | "maia";
  label: string;
  ids: EngineAssetId[];
  bytesReceived: number;
  bytesTotal: number;
  status: AssetStatus;
  /** The first failed member's error message, as main reported it. */
  errorMessage?: string;
};

const ROW_STATUS_ORDER: readonly AssetStatus[] = [
  "error",
  "downloading",
  "verifying",
  "installing",
  "pending",
  "ready"
];

const SETUP_ROW_LABELS: Record<SetupRow["key"], string> = {
  stockfish: "Stockfish",
  lc0: "Lc0",
  maia: "Maia"
};

/** The setup row an asset is listed in. */
function setupRowKey(id: EngineAssetId): SetupRow["key"] {
  if (id === "stockfish") return "stockfish";
  return id === "lc0" || id === "lc0-network" ? "lc0" : "maia";
}

/**
 * One asset's share of its row's progress. Verifying / installing / ready members count as fully
 * downloaded; a failed one counts nothing.
 */
function memberProgress(
  asset: EngineAssetStatus,
  entry: AssetProgress | undefined
): { bytesReceived: number; bytesTotal: number; status: AssetStatus } {
  const bytesTotal = entry?.bytesTotal || asset.downloadSizeBytes || 0;
  const status = entry?.status ?? "pending";
  const done = status === "verifying" || status === "installing" || status === "ready";
  const bytesReceived = done ? bytesTotal : status === "error" ? 0 : (entry?.bytesReceived ?? 0);
  return { bytesReceived, bytesTotal, status };
}

/** "Maia 1100–1900", "Maia 1500": the Maia row's ratings. */
function maiaRowLabel(ids: readonly EngineAssetId[]): string {
  const ratings = ids.map((id) => id.replace("maia-", ""));
  return ratings.length > 1
    ? `Maia ${ratings[0]}–${ratings[ratings.length - 1]}`
    : `Maia ${ratings[0]}`;
}

/**
 * Groups queued assets into setup rows with combined progress. A row's status is its most
 * pressing member's: any failure, then any work in progress, then waiting; ready only when all are.
 */
export function setupRows(
  assets: readonly EngineAssetStatus[],
  progress: AssetProgressMap
): SetupRow[] {
  const rows: SetupRow[] = [];
  const byKey = new Map<SetupRow["key"], SetupRow>();
  for (const asset of assets) {
    const key = setupRowKey(asset.id);
    let row = byKey.get(key);
    if (!row) {
      row = {
        key,
        label: SETUP_ROW_LABELS[key],
        ids: [],
        bytesReceived: 0,
        bytesTotal: 0,
        status: "ready"
      };
      byKey.set(key, row);
      rows.push(row);
    }
    const member = memberProgress(asset, progress[asset.id]);
    row.ids.push(asset.id);
    row.bytesTotal += member.bytesTotal;
    row.bytesReceived += member.bytesReceived;
    if (ROW_STATUS_ORDER.indexOf(member.status) < ROW_STATUS_ORDER.indexOf(row.status))
      row.status = member.status;
    const errorMessage = progress[asset.id]?.errorMessage;
    if (member.status === "error" && errorMessage && !row.errorMessage)
      row.errorMessage = errorMessage;
  }
  for (const row of rows) {
    if (row.key === "maia") row.label = maiaRowLabel(row.ids);
  }
  return rows;
}

/** Whole-number percentage of a setup row (0 before sizes are known). */
export function setupRowPercent(row: Pick<SetupRow, "bytesReceived" | "bytesTotal">): number {
  return row.bytesTotal ? Math.min(100, Math.round((row.bytesReceived / row.bytesTotal) * 100)) : 0;
}
