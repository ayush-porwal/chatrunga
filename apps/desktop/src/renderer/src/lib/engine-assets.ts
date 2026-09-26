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
