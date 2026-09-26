import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { Progress } from "@/components/ui/progress";
import type { EngineAssetStatus, EngineAssetStatusMap } from "@chaturanga/shared/ipc/chaturanga-api";
import {
  ENGINE_ASSETS,
  applyAssetProgress,
  fetchAssetStatus,
  formatSize,
  initialAssetProgress,
  missingDownloads,
  progressPercent,
  type AssetProgress,
  type AssetProgressMap
} from "@/lib/engine-assets";

/**
 * First-launch welcome + engine setup modal.
 *
 * Renders when useFirstLaunch determines no engine is configured AND the user
 * hasn't dismissed. The flow:
 *
 *   1. Welcome → "Download for me", "I'll use my own engines", or close (X / Esc)
 *   2. Progress per missing, downloadable asset (Stockfish, Lc0 where available, Maia 1100..1900)
 *   3. "Engines ready" on success, OR the error + retry / "Use my own engines"
 *
 * Every view can be closed (X, Esc, backdrop — via <Dialog onClose>); closing while
 * downloading leaves the downloads running in the background.
 */

type View = "welcome" | "downloading" | "done" | "error";

export function WelcomeModal(props: {
  /** Permanent "don't show again" — used by "I'll use my own" + auto-dismiss on success. */
  onMaybeLater: () => void;
  /** Soft close — keep the user but allow re-show on next launch. */
  onDismiss: () => void;
}) {
  const [view, setView] = useState<View>("welcome");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<EngineAssetStatusMap | null>(null);
  // Fixed when the download starts, so rows don't disappear as assets finish installing.
  const [queued, setQueued] = useState<EngineAssetStatus[]>([]);
  const [progress, setProgress] = useState<AssetProgressMap>({});

  useEffect(() => {
    void fetchAssetStatus().then(setStatus, () => undefined);
  }, []);

  useEffect(() => {
    if (view !== "downloading") return;
    const off = window.chaturanga?.onAssetProgress((event) => setProgress((current) => applyAssetProgress(current, event)));
    return () => off?.();
  }, [view]);

  const startDownload = async () => {
    const latest = (await fetchAssetStatus().catch(() => null)) ?? status;
    const assets = missingDownloads(latest);
    setQueued(assets);
    setProgress(initialAssetProgress(assets));
    setView("downloading");
    setErrorMessage(null);
    try {
      const summary = await window.chaturanga?.assets.downloadAll();
      if (summary && summary.failed.length === 0) {
        setView("done");
      } else if (summary) {
        const failedList = summary.failed.map((f) => `• ${f.id}: ${f.reason}`).join("\n");
        setErrorMessage(`Some downloads failed:\n${failedList}`);
        setView("error");
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setErrorMessage(`Engine download failed: ${msg}`);
      setView("error");
    }
  };

  if (view === "downloading") {
    return (
      <Dialog
        size="sm"
        title="Setting up engines"
        description="You can close this — downloads continue in the background."
        onClose={props.onDismiss}
        footer={
          <Button variant="outline" size="sm" onClick={props.onDismiss}>
            Continue in background
          </Button>
        }
      >
        <div className="grid gap-2.5">
          {queued.map((asset) => (
            <Row key={asset.id} label={labelFor(asset)} progress={progress[asset.id]} />
          ))}
        </div>
      </Dialog>
    );
  }

  if (view === "done") {
    return (
      <Dialog
        size="sm"
        title="Engines ready"
        description={`Review a game to see the rating curve and coach commentary.${
          status?.lc0.autoDownload === false ? " Lc0 needs a manual install — see Settings → Engine downloads." : ""
        }`}
        onClose={props.onDismiss}
        footer={
          <Button variant="primary" size="sm" onClick={props.onDismiss}>
            Start using Chaturanga
          </Button>
        }
      />
    );
  }

  if (view === "error") {
    return (
      <Dialog
        size="sm"
        title="Couldn't download engines"
        description="Try again, or skip and point Settings → Engines at engines you already have."
        onClose={props.onDismiss}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={props.onMaybeLater}>
              Use my own engines
            </Button>
            <Button variant="primary" size="sm" onClick={() => void startDownload()}>
              Try again
            </Button>
          </>
        }
      >
        <Notice tone="danger" className="scroll-area max-h-48 overflow-auto">
          {errorMessage ?? "Unknown error."}
        </Notice>
      </Dialog>
    );
  }

  const downloadSize = formatSize(missingDownloads(status).reduce((sum, asset) => sum + (asset.downloadSizeBytes ?? 0), 0));
  return (
    <Dialog
      size="sm"
      title="Welcome to Chaturanga"
      description={`Download the engines Game review uses${downloadSize ? ` (about ${downloadSize}, one time)` : ""} — or skip and point Settings → Engines at engines you already have.`}
      onClose={props.onDismiss}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={props.onMaybeLater}>
            I'll use my own engines
          </Button>
          <Button variant="primary" size="sm" onClick={() => void startDownload()}>
            <Download />
            Download for me
          </Button>
        </>
      }
    />
  );
}

function Row({ label, progress }: { label: string; progress?: AssetProgress }) {
  const status = progress?.status ?? "pending";
  const pct = progressPercent(progress);
  const value =
    status === "ready" || status === "error"
      ? 100
      : status === "verifying" || status === "installing"
        ? null
        : status === "downloading"
          ? pct
          : 0;
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)_5.5rem] items-center gap-3">
      <span className="truncate text-sm text-fg-secondary">{label}</span>
      <Progress value={value} tone={status === "error" ? "danger" : "accent"} aria-label={`${label} progress`} />
      <span className="flex justify-end">
        {status === "ready" ? (
          <Badge tone="accent">Ready</Badge>
        ) : status === "error" ? (
          <Badge tone="danger" title={progress?.errorMessage}>
            Failed
          </Badge>
        ) : (
          <span className="text-xs tabular-nums text-fg-subtle">{statusLabel(status, pct)}</span>
        )}
      </span>
    </div>
  );
}

function labelFor(asset: EngineAssetStatus): string {
  return ENGINE_ASSETS.find((entry) => entry.id === asset.id)?.label ?? asset.id;
}

function statusLabel(status: AssetProgress["status"], pct: number): string {
  switch (status) {
    case "pending":
      return "Queued";
    case "downloading":
      return `${pct}%`;
    case "verifying":
      return "Verifying…";
    case "installing":
      return "Installing…";
    case "ready":
      return "Ready";
    case "error":
      return "Failed";
  }
}
