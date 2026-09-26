import { useEffect, useState, type ReactNode } from "react";
import { Check, CheckCircle2, CircleAlert, Circle, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
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
import { cn } from "@/lib/utils";

/**
 * First-launch welcome + engine setup modal.
 *
 * Renders when useFirstLaunch determines no engine is configured AND the user
 * hasn't dismissed. The flow:
 *
 *   1. Welcome → "Download engines", "I'll use my own engines", or close (X / Esc)
 *   2. Progress per missing, downloadable asset (Stockfish, Lc0 where available, Maia 1100..1900)
 *   3. "Engines ready" on success, OR the error + retry / "Use my own engines"
 *
 * Every view can be closed (X, Esc, backdrop — via <Dialog onClose>); closing while
 * downloading leaves the downloads running in the background. One <Dialog> for every step, so the
 * panel stays put and only its contents change.
 */

type View = "welcome" | "downloading" | "done" | "error";

/** What each download is for, in the user's terms. */
const assetPurpose: Record<string, string> = {
  stockfish: "Scores every move in analysis and Game review",
  lc0: "Neural-network engine for a second opinion",
  maia: "Predicts what players of each rating would play"
};

export function WelcomeModal(props: {
  /** Permanent "don't show again" — used by "I'll use my own" + auto-dismiss on success. */
  onMaybeLater: () => void;
  /** Soft close — keep the user but allow re-show on next launch. */
  onDismiss: () => void;
}) {
  const [view, setView] = useState<View>("welcome");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<EngineAssetStatusMap | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  // Fixed when the download starts, so rows don't disappear as assets finish installing.
  const [queued, setQueued] = useState<EngineAssetStatus[]>([]);
  const [progress, setProgress] = useState<AssetProgressMap>({});

  useEffect(() => {
    void fetchAssetStatus()
      .then(setStatus, () => undefined)
      .finally(() => setStatusLoaded(true));
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
        const failedList = summary.failed.map((f) => `• ${labelForId(f.id)}: ${f.reason}`).join("\n");
        setErrorMessage(`Some downloads failed:\n${failedList}`);
        setView("error");
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setErrorMessage(`Engine download failed: ${msg}`);
      setView("error");
    }
  };

  const missing = missingDownloads(status);
  const downloadBytes = missing.reduce((sum, asset) => sum + (asset.downloadSizeBytes ?? 0), 0);
  const downloadSize = formatSize(downloadBytes);
  const lc0Manual = status?.lc0.autoDownload === false;

  let title: ReactNode;
  let description: ReactNode;
  let footer: ReactNode;
  let body: ReactNode;

  if (view === "downloading") {
    const readyCount = queued.filter((asset) => progress[asset.id]?.status === "ready").length;
    const totalBytes = queued.reduce((sum, asset) => sum + (progress[asset.id]?.bytesTotal || asset.downloadSizeBytes || 0), 0);
    // Verifying / installing / ready assets are fully downloaded, whatever their last byte count said.
    const receivedBytes = queued.reduce((sum, asset) => {
      const entry = progress[asset.id];
      if (!entry) return sum;
      const downloaded = entry.status === "verifying" || entry.status === "installing" || entry.status === "ready";
      return sum + (downloaded ? entry.bytesTotal || asset.downloadSizeBytes || 0 : entry.bytesReceived);
    }, 0);
    const overall = totalBytes ? Math.round((receivedBytes / totalBytes) * 100) : 0;
    title = "Setting up engines";
    description = "You can close this; downloads continue in the background.";
    footer = (
      <Button variant="outline" size="sm" onClick={props.onDismiss}>
        Continue in background
      </Button>
    );
    body = (
      <div className="grid gap-4">
        <div className="grid gap-2">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-fg-secondary">
              <span className="tabular-nums">{readyCount}</span> of <span className="tabular-nums">{queued.length}</span> ready
            </span>
            <span className="tabular-nums text-fg-subtle">
              {formatSize(receivedBytes) ?? "0 MB"}
              {totalBytes ? ` of ${formatSize(totalBytes)}` : ""}
            </span>
          </div>
          <Progress value={overall} aria-label="Overall engine download progress" />
        </div>
        <ul className="grid gap-1 rounded-lg border border-line-subtle bg-surface-sunken p-1.5">
          {queued.map((asset) => (
            <DownloadRow key={asset.id} label={labelForId(asset.id)} progress={progress[asset.id]} />
          ))}
        </ul>
      </div>
    );
  } else if (view === "done") {
    title = "Engines ready";
    description = undefined;
    footer = (
      <Button variant="primary" size="sm" onClick={props.onDismiss}>
        Start using Chaturanga
      </Button>
    );
    body = (
      <div className="grid justify-items-center gap-3 py-4 text-center">
        <span className="grid size-12 animate-pop-in place-items-center rounded-full bg-accent-soft text-accent ring-1 ring-accent/30">
          <Check className="size-6" strokeWidth={2.5} aria-hidden="true" />
        </span>
        <div className="grid max-w-xs gap-1">
          <p className="text-sm font-medium text-fg">
            {installedSummary(queued)}
          </p>
          <p className="text-sm leading-6 text-fg-muted">
            Import a game and open Game review to see every move rated and explained.
          </p>
          {lc0Manual ? (
            <p className="text-2xs leading-4 text-fg-subtle">Lc0 needs a manual install; see Settings, Engine downloads.</p>
          ) : null}
        </div>
      </div>
    );
  } else if (view === "error") {
    title = "Couldn’t download engines";
    description = "Try again, or skip and point Settings → Engines at engines you already have.";
    footer = (
      <>
        <Button variant="outline" size="sm" onClick={props.onMaybeLater}>
          Use my own engines
        </Button>
        <Button variant="primary" size="sm" onClick={() => void startDownload()}>
          Try again
        </Button>
      </>
    );
    body = (
      <div className="grid gap-3">
        {queued.length ? (
          <ul className="grid gap-1 rounded-lg border border-line-subtle bg-surface-sunken p-1.5">
            {queued.map((asset) => (
              <DownloadRow key={asset.id} label={labelForId(asset.id)} progress={progress[asset.id]} />
            ))}
          </ul>
        ) : null}
        <Notice tone="danger" className="scroll-area max-h-40 overflow-auto">
          {errorMessage ?? "Unknown error."}
        </Notice>
      </div>
    );
  } else {
    title = "Welcome to Chaturanga";
    description = "Analyze positions, review your games move by move, and train on puzzles, all on this computer.";
    footer = (
      <>
        <Button variant="ghost" size="sm" onClick={props.onMaybeLater}>
          I’ll use my own engines
        </Button>
        <Button variant="primary" size="sm" disabled={statusLoaded && missing.length === 0} onClick={() => void startDownload()}>
          <Download />
          {downloadSize ? `Download engines (${downloadSize})` : "Download engines"}
        </Button>
      </>
    );
    body = (
      <div className="grid gap-3">
        <p className="text-xs text-fg-muted">These free engines power analysis and Game review. One download, kept up to date only when you ask.</p>
        <ul className="grid gap-px overflow-hidden rounded-lg border border-line-subtle bg-line-subtle">
          {statusLoaded ? (
            engineGroups(missing).map((group) => (
              <li key={group.key} className="flex items-center gap-3 bg-surface-sunken px-3 py-2.5">
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-sm text-fg-secondary">{group.label}</span>
                  <span className="truncate text-xs text-fg-subtle">{assetPurpose[group.key]}</span>
                </span>
                {group.bytes ? <span className="shrink-0 text-xs tabular-nums text-fg-subtle">{formatSize(group.bytes)}</span> : null}
              </li>
            ))
          ) : (
            [0, 1, 2].map((index) => (
              <li key={index} className="grid gap-1.5 bg-surface-sunken px-3 py-2.5">
                <Skeleton as="span" className="h-3 w-24 rounded" />
                <Skeleton as="span" className="h-2.5 w-52 rounded bg-control/70" />
              </li>
            ))
          )}
        </ul>
        {lc0Manual ? (
          <p className="text-2xs leading-4 text-fg-subtle">
            Lc0 has no download for this computer; you can add it later in Settings.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <Dialog size="sm" title={title} description={description} onClose={props.onDismiss} footer={footer}>
      <div key={view} className="animate-fade-in">
        {body}
      </div>
    </Dialog>
  );
}

/** Stockfish and Lc0 on their own rows; the five Maia networks as one row with their combined size. */
function engineGroups(assets: readonly EngineAssetStatus[]): { key: string; label: string; bytes: number }[] {
  const groups: { key: string; label: string; bytes: number }[] = [];
  const maia = assets.filter((asset) => asset.id.startsWith("maia-"));
  for (const asset of assets) {
    if (asset.id.startsWith("maia-")) continue;
    groups.push({ key: asset.id, label: labelForId(asset.id), bytes: asset.downloadSizeBytes ?? 0 });
  }
  if (maia.length) {
    const ratings = maia.map((asset) => asset.id.replace("maia-", ""));
    groups.push({
      key: "maia",
      label: maia.length === 1 ? `Maia ${ratings[0]}` : `Maia ${ratings[0]}–${ratings[ratings.length - 1]} (${maia.length} networks)`,
      bytes: maia.reduce((sum, asset) => sum + (asset.downloadSizeBytes ?? 0), 0)
    });
  }
  return groups;
}

/** "Stockfish and Maia 1100–1900 installed" (list formatted for the locale). */
function installedSummary(assets: readonly EngineAssetStatus[]): string {
  const names = engineGroups(assets).map((group) => group.label.replace(/ \(.*\)$/, ""));
  if (!names.length) return "Your engines are installed";
  return `${new Intl.ListFormat(undefined, { type: "conjunction" }).format(names)} installed`;
}

function DownloadRow({ label, progress }: { label: string; progress?: AssetProgress }) {
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
    <li className="grid grid-cols-[1rem_6.5rem_minmax(0,1fr)_4.75rem] items-center gap-3 rounded-md px-2 py-1.5">
      <StatusIcon status={status} />
      <span className={cn("truncate text-sm", status === "pending" ? "text-fg-muted" : "text-fg-secondary")}>{label}</span>
      <span
        className={cn(
          "transition-opacity duration-standard",
          status === "ready" || status === "pending" ? "opacity-40" : "opacity-100"
        )}
      >
        <Progress value={value} tone={status === "error" ? "danger" : "accent"} aria-label={`${label} progress`} />
      </span>
      <span
        className={cn(
          "text-right text-xs tabular-nums",
          status === "ready" ? "text-accent" : status === "error" ? "text-danger" : "text-fg-subtle"
        )}
        title={status === "error" ? progress?.errorMessage : undefined}
      >
        {statusLabel(status, pct)}
      </span>
    </li>
  );
}

function StatusIcon({ status }: { status: AssetProgress["status"] }) {
  const className = "size-4";
  switch (status) {
    case "ready":
      return <CheckCircle2 key="ready" className={cn(className, "animate-pop-in text-accent")} aria-hidden="true" />;
    case "error":
      return <CircleAlert key="error" className={cn(className, "animate-pop-in text-danger")} aria-hidden="true" />;
    case "pending":
      return <Circle key="pending" className={cn(className, "text-fg-subtle/60")} aria-hidden="true" />;
    default:
      return <Loader2 key="busy" className={cn(className, "animate-spin text-fg-muted")} aria-hidden="true" />;
  }
}

function labelForId(id: string): string {
  return ENGINE_ASSETS.find((entry) => entry.id === id)?.label ?? id;
}

function statusLabel(status: AssetProgress["status"], pct: number): string {
  switch (status) {
    case "pending":
      return "Queued";
    case "downloading":
      return `${pct}%`;
    case "verifying":
      return "Verifying";
    case "installing":
      return "Installing";
    case "ready":
      return "Ready";
    case "error":
      return "Failed";
  }
}
