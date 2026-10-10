import { useCallback, useEffect, useState } from "react";
import type { EngineAssetId, EngineAssetStatusMap } from "@chaturanga/shared/ipc/chaturanga-api";
import {
  applyAssetProgress,
  fetchAssetStatus,
  missingDownloads,
  type AssetProgressMap
} from "@/lib/engine-assets";

/**
 * Settings → Engines' downloads: which engines + Maia networks are installed (and at which
 * version), live progress, and the download / update / remove / custom-binary actions. `status`
 * stays null outside the desktop app. The first-run welcome (features/onboarding) handles the
 * initial download.
 */
export function useEngineAssets() {
  const [status, setStatus] = useState<EngineAssetStatusMap | null>(null);
  const [progress, setProgress] = useState<AssetProgressMap>({});
  const [busy, setBusy] = useState<Partial<Record<EngineAssetId, boolean>>>({});
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchAssetStatus();
      if (next) setStatus(next);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const offStatus = window.chaturanga?.onAssetStatusChanged(() => void refresh());
    const offProgress = window.chaturanga?.onAssetProgress((event) => {
      setProgress((current) => applyAssetProgress(current, event));
      if (event.type === "ready" || event.type === "error") void refresh();
    });
    return () => {
      offStatus?.();
      offProgress?.();
    };
  }, [refresh]);

  /** Runs one asset action with its row marked busy; `action` resolves with an error or null. */
  const runForAsset = async (id: EngineAssetId, action: () => Promise<string | null>) => {
    setBusy((current) => ({ ...current, [id]: true }));
    setError(null);
    try {
      const failure = await action();
      if (failure) setError(failure);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy((current) => ({ ...current, [id]: false }));
      setProgress((current) => ({ ...current, [id]: undefined }));
      void refresh();
    }
  };

  const api = window.chaturanga?.assets;
  const install = (id: EngineAssetId, kind: "download" | "update") =>
    runForAsset(id, async () => {
      const result = await (kind === "update" ? api?.update(id) : api?.download(id));
      return result && !result.ok ? result.error : null;
    });
  const remove = (id: EngineAssetId) =>
    runForAsset(id, async () => {
      await api?.remove(id);
      return null;
    });
  const pickCustomFile = (id: EngineAssetId) =>
    runForAsset(id, async () => {
      const file = await window.chaturanga?.files.selectExecutable();
      if (file) await api?.setCustomPath(id, file);
      return null;
    });

  const missing = missingDownloads(status);
  const downloadMissing = async () => {
    setError(null);
    setBusy(Object.fromEntries(missing.map((asset) => [asset.id, true])));
    try {
      const summary = await api?.downloadAll();
      const [first, ...rest] = summary?.failed ?? [];
      if (first)
        setError(
          rest.length
            ? `${rest.length + 1} downloads failed. First: ${first.id} — ${first.reason}`
            : `${first.id}: ${first.reason}`
        );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy({});
      setProgress({});
      void refresh();
    }
  };

  const checkForUpdates = async () => {
    setChecking(true);
    setError(null);
    try {
      const next = await api?.checkForUpdates();
      if (next) setStatus(next);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setChecking(false);
    }
  };

  return {
    status,
    progress,
    busy,
    checking,
    error,
    missing,
    install,
    remove,
    pickCustomFile,
    downloadMissing,
    checkForUpdates
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
