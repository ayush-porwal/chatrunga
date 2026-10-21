import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { EngineAssetStatusMap } from "@chaturanga/shared/ipc/chaturanga-api";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import {
  fetchAssetStatus,
  isAssetInstalled,
  lc0NeedsManualInstall,
  recommendedDownloads,
  setupRowPercent,
  setupRows,
  type AssetProgressMap,
  type SetupRow
} from "@/lib/engine-assets";
import { useEnginesQuery } from "../../queries/api";
import { selectSetupRunning, useEngineSetupStore } from "../../stores/engine-setup-store";
import { engineSetupPhase, evaluationEngine, type EngineSetupPhase } from "./onboarding-state";

export type EngineSetup = {
  statusLoaded: boolean;
  /** The download status couldn't be read (the check failed, or no desktop bridge). */
  statusFailed: boolean;
  /** Stockfish, Lc0 + Maia as the setup list shows them (sizes before, progress during, done after). */
  rows: SetupRow[];
  /** Nothing downloaded or queued yet, and something to offer. */
  offer: boolean;
  /** Bytes the recommended download would fetch. */
  offerBytes: number;
  phase: EngineSetupPhase;
  /** A usable evaluation engine exists (Game review can run). */
  engineReady: boolean;
  /** That engine (the user's own, or the installed Stockfish), else null. */
  engine: EngineConfig | null;
  /** Stockfish's download percentage while it is being fetched, else null. */
  stockfishPercent: number | null;
  /** Maia needs Lc0, which has no download for this computer (lc0NeedsManualInstall). */
  lc0Manual: boolean;
  start: () => void;
  retry: (row: SetupRow) => void;
  /** Reads the download status again (after a failed check). */
  recheck: () => void;
};

/**
 * The state of the first-run engine setup, shared by the welcome, Play and Game review: what is
 * installed, what the welcome recommends, and the downloads it started (useEngineSetupStore).
 */
export function useEngineSetup(): EngineSetup {
  const [status, setStatus] = useState<EngineAssetStatusMap | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const engines = useEnginesQuery();
  const { queued, progress, running, startDownloads, retryDownloads } = useEngineSetupStore(
    useShallow((state) => ({
      queued: state.queued,
      progress: state.progress,
      running: selectSetupRunning(state),
      startDownloads: state.start,
      retryDownloads: state.retry
    }))
  );

  const refresh = useCallback(() => {
    void fetchAssetStatus()
      .then(
        (next) => setStatus(next),
        () => undefined
      )
      .finally(() => setStatusLoaded(true));
  }, []);

  useEffect(() => {
    refresh();
    return window.chaturanga?.onAssetStatusChanged(refresh);
  }, [refresh]);
  // Installs finishing change what is missing.
  const readyCount = Object.values(progress).filter((entry) => entry.status === "ready").length;
  useEffect(() => {
    if (readyCount) refresh();
  }, [readyCount, refresh]);

  const engine = evaluationEngine(engines.data);
  const engineReady = Boolean(engine);
  // With an evaluation engine already working (e.g. the user's own), Stockfish adds nothing.
  const recommended = useMemo(
    () =>
      recommendedDownloads(status).filter((asset) => !(engineReady && asset.id === "stockfish")),
    [engineReady, status]
  );
  const rows = useMemo(() => {
    if (queued.length) return setupRows(queued, progress);
    if (recommended.length) return setupRows(recommended, {});
    // Everything recommended is installed: show it as done.
    const installed = status
      ? [
          status.stockfish,
          status.lc0,
          status["lc0-network"],
          status["maia-1100"],
          status["maia-1300"],
          status["maia-1500"],
          status["maia-1700"],
          status["maia-1900"]
        ].filter((asset) => isAssetInstalled(asset))
      : [];
    const done: AssetProgressMap = Object.fromEntries(
      installed.map((asset) => [
        asset.id,
        { bytesReceived: asset.sizeBytes, bytesTotal: asset.sizeBytes, status: "ready" as const }
      ])
    );
    return setupRows(installed, done);
  }, [progress, queued, recommended, status]);

  const stockfishRow = rows.find((row) => row.key === "stockfish");
  const stockfishBusy =
    stockfishRow &&
    queued.length &&
    stockfishRow.status !== "ready" &&
    stockfishRow.status !== "error";

  return {
    statusLoaded,
    statusFailed: statusLoaded && status === null,
    rows,
    offer: !queued.length && recommended.length > 0,
    offerBytes: recommended.reduce((sum, asset) => sum + (asset.downloadSizeBytes ?? 0), 0),
    phase: engineSetupPhase({
      statusLoaded,
      engineReady,
      running,
      rows: queued.length ? rows : []
    }),
    engineReady,
    engine,
    stockfishPercent: stockfishBusy ? setupRowPercent(stockfishRow) : null,
    lc0Manual: lc0NeedsManualInstall(status),
    start: () => void startDownloads(recommended),
    retry: (row) => void retryDownloads(row.ids.filter((id) => progress[id]?.status === "error")),
    recheck: () => {
      setStatusLoaded(false);
      refresh();
    }
  };
}
