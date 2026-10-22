import { useCallback, useEffect, useState } from "react";
import type { EngineAssetStatus } from "@chaturanga/shared/ipc/chaturanga-api";
import {
  fetchAssetStatus,
  formatSize,
  isAssetInstalled,
  progressPercent
} from "@/lib/engine-assets";
import { useEngineSetupStore } from "../../stores/engine-setup-store";

/** Where Maia 3's download stands, for an offer to download it where Maia is needed. */
export type Maia3Download = {
  /**
   * `unknown`: status not read yet (or outside the desktop app); `missing`: not installed and
   * downloadable here (offer it); `downloading`; `failed`: the last download failed (offer Retry);
   * `installed`.
   */
  state: "unknown" | "missing" | "downloading" | "failed" | "installed";
  /** The download's percentage while it runs (0 before its size is known). */
  percent: number;
  /** The download's size, "45.7 MB" (null when unknown). */
  size: string | null;
  /** Why the last download failed, as main reported it. */
  error: string | null;
  /** Downloads Maia 3 (the user asked for it): progress is shared with the engine setup. */
  start: () => void;
};

/**
 * Maia 3's download, wherever Maia is needed and isn't installed yet ("Maia 3 is available" with a
 * Download button): its status, and a download that runs through the first-run setup's store, so
 * its progress survives the offer closing and shows wherever else it is offered.
 */
export function useMaia3Download(): Maia3Download {
  const [status, setStatus] = useState<EngineAssetStatus | null>(null);
  const progress = useEngineSetupStore((state) => state.progress.maia3);
  const running = useEngineSetupStore((state) => state.active.includes("maia3"));
  const refresh = useCallback(() => {
    fetchAssetStatus().then(
      (next) => setStatus(next?.maia3 ?? null),
      () => undefined
    );
  }, []);
  useEffect(() => {
    refresh();
    return window.chaturanga?.onAssetStatusChanged(refresh);
  }, [refresh]);
  // A finished download changes what is installed.
  const done = progress?.status === "ready";
  useEffect(() => {
    if (done) refresh();
  }, [done, refresh]);

  const installed = isAssetInstalled(status ?? undefined);
  let state: Maia3Download["state"] = "unknown";
  if (installed) state = "installed";
  else if (running) state = "downloading";
  else if (progress?.status === "error") state = "failed";
  else if (status?.autoDownload) state = "missing";
  return {
    state,
    percent: progressPercent(progress),
    size: formatSize(status?.downloadSizeBytes),
    error: progress?.status === "error" ? (progress.errorMessage ?? null) : null,
    start: () => {
      if (status && !installed) void useEngineSetupStore.getState().start([status]);
    }
  };
}
