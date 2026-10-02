import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Download, FolderOpen, Loader2, RefreshCw, Trash2 } from "lucide-react";
import type { EngineAssetId, EngineAssetStatus, EngineAssetStatusMap } from "@chaturanga/shared/ipc/chaturanga-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { OverflowMenu } from "@/components/ui/menu";
import { Notice } from "@/components/ui/notice";
import { SectionHeader } from "@/components/ui/page";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ENGINE_ASSETS,
  applyAssetProgress,
  fetchAssetStatus,
  maiaNeedsLc0,
  formatSize,
  isAssetInstalled,
  missingDownloads,
  progressPercent,
  type AssetProgressMap
} from "@/lib/engine-assets";
import { cardPadded, fieldHint, listRow, well } from "@/lib/ui";
import { cn } from "@/lib/utils";

/**
 * Settings → Engine downloads: which engines + Maia networks are installed (and at which
 * version), downloads, user-triggered updates to the latest GitHub release, and removal.
 * The first-run welcome (features/onboarding) handles the initial download.
 */
export function EngineAssetsPanel() {
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
      if (first) setError(rest.length ? `${rest.length + 1} downloads failed. First: ${first.id} — ${first.reason}` : `${first.id}: ${first.reason}`);
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

  const entries = status ? ENGINE_ASSETS.map((asset) => ({ ...asset, status: status[asset.id] })) : [];
  const checkError = entries.find((entry) => entry.status.checkError)?.status.checkError ?? null;
  const lastChecked = latestCheckedAt(entries.map((entry) => entry.status));

  return (
    <section className={cn(cardPadded, "grid gap-3")} aria-labelledby="engine-downloads-title">
      <SectionHeader
        title={<span id="engine-downloads-title">Engine downloads</span>}
        description="Stockfish, Lc0 and the five Maia networks Game review uses. Updates install only when you ask."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void checkForUpdates()} disabled={checking || !status}>
              <RefreshCw className={cn(checking && "animate-spin")} />
              {checking ? "Checking…" : "Check for updates"}
            </Button>
            {missing.length > 0 ? (
              <Button variant="primary" size="sm" onClick={() => void downloadMissing()}>
                <Download />
                Download missing ({missing.length})
              </Button>
            ) : null}
          </>
        }
      />

      {maiaNeedsLc0(status) ? (
        <Notice tone="warn" title="Maia needs Lc0">
          The Maia networks are installed, but Maia runs inside Lc0, which isn't set up yet. Install Lc0
          (the command is below), then choose its binary from the Lc0 row's menu. Until then Maia isn't
          used in reviews and can't be played against.
        </Notice>
      ) : null}
      {status ? (
        <div className="grid gap-1.5">
          {entries.map((entry) =>
            entry.status.autoDownload ? (
              <AssetRow
                key={entry.id}
                label={entry.label}
                status={entry.status}
                busy={busy[entry.id] ?? false}
                percent={progressPercent(progress[entry.id])}
                onDownload={() => void install(entry.id, "download")}
                onUpdate={() => void install(entry.id, "update")}
                onRemove={() => void remove(entry.id)}
              />
            ) : (
              <ManualInstallRow
                key={entry.id}
                label={entry.label}
                status={entry.status}
                onPickFile={() => void pickCustomFile(entry.id)}
                onRemove={() => void remove(entry.id)}
              />
            )
          )}
        </div>
      ) : (
        <div className="grid gap-1.5" aria-busy="true" aria-label="Reading installed engines">
          {ENGINE_ASSETS.map((asset) => (
            <div key={asset.id} className={cn(listRow, "gap-3")}>
              <Skeleton as="span" className="h-3 w-24 rounded" />
              <Skeleton as="span" className="ml-auto h-5 w-16 rounded-full" />
              <span className="size-8 shrink-0" />
            </div>
          ))}
        </div>
      )}

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <p className={fieldHint}>
        {checkError ? `Couldn't reach GitHub (${checkError}); showing the last known releases. ` : null}
        {lastChecked ? `Releases checked ${lastChecked}. ` : null}
        Maia networks by{" "}
        <a
          href="https://github.com/CSSLab/maia-chess"
          target="_blank"
          rel="noopener noreferrer"
          className="text-info hover:underline"
        >
          CSSLab
        </a>{" "}
        (CC BY). Stockfish is GPL-3.0.
      </p>
    </section>
  );
}

function AssetRow(props: {
  label: string;
  status: EngineAssetStatus;
  busy: boolean;
  percent: number;
  onDownload: () => void;
  onUpdate: () => void;
  onRemove: () => void;
}) {
  const { status } = props;
  const installed = isAssetInstalled(status);
  const size = formatSize(installed ? status.sizeBytes : status.downloadSizeBytes);
  const downloading = props.busy && props.percent > 0 && props.percent < 100;
  return (
    <div className={cn(listRow, "relative overflow-hidden transition-colors duration-standard", props.busy && "border-line-strong")}>
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate text-fg" title={props.label}>
          {props.label}
        </span>
        {installed && status.installedVersion ? (
          <span className="truncate font-mono text-xs text-fg-subtle" title={status.installedVersion}>
            {status.installedVersion}
          </span>
        ) : null}
      </span>
      {size ? <span className="shrink-0 text-xs tabular-nums text-fg-subtle">{size}</span> : null}
      {props.busy ? (
        <Badge tone="warn" className="tabular-nums">
          {downloading ? `Downloading ${props.percent}%` : "Working…"}
        </Badge>
      ) : status.updateAvailable ? (
        <Badge tone="warn" title={`Latest release ${status.latestVersion ?? ""}`}>
          Update · {status.latestVersion}
        </Badge>
      ) : (
        <StatusBadge state={status.state} />
      )}
      {props.busy ? (
        <span className="grid size-8 shrink-0 place-items-center text-fg-subtle" aria-label="Working">
          <Loader2 className="size-4 animate-spin" />
        </span>
      ) : (
        <>
          {status.updateAvailable ? (
            <Button variant="outline" size="xs" onClick={props.onUpdate}>
              Update
            </Button>
          ) : null}
          {installed ? (
            <IconButton label={`Remove ${props.label}`} icon={<Trash2 />} onClick={props.onRemove} />
          ) : (
            <IconButton label={`Download ${props.label}`} icon={<Download />} onClick={props.onDownload} />
          )}
        </>
      )}
      {props.busy ? (
        /* Row-wide progress along the bottom edge; scaleX so only a transform animates. */
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-0.5 animate-fade-in overflow-hidden bg-accent/10"
        >
          {downloading ? (
            <span
              className="block h-full origin-left bg-accent transition-transform duration-standard ease-standard"
              style={{ transform: `scaleX(${props.percent / 100})` }}
            />
          ) : (
            <span className="block h-full w-1/3 animate-indeterminate bg-accent/70" />
          )}
        </span>
      ) : null}
    </div>
  );
}

/**
 * No download for this platform (Lc0 on macOS / Linux: upstream publishes no binaries). The
 * user installs it (e.g. Homebrew) and points the asset at the binary; while missing, the
 * install command is shown under the row with a copy button.
 */
function ManualInstallRow(props: {
  label: string;
  status: EngineAssetStatus;
  onPickFile: () => void;
  onRemove: () => void;
}) {
  const installed = isAssetInstalled(props.status);
  const instruction = props.status.installInstructions ?? "Install Lc0 from https://lczero.org/play/download/";
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [copied]);
  // A refused clipboard write leaves the command selectable in the row below.
  const copy = () => navigator.clipboard.writeText(instruction).then(() => setCopied(true), () => undefined);
  const size = installed ? formatSize(props.status.sizeBytes) : null;
  return (
    <div className="grid gap-1.5">
      <div className={listRow}>
        <span className="min-w-0 flex-1 truncate text-fg">{props.label}</span>
        {size ? <span className="shrink-0 font-mono text-xs text-fg-subtle tabular-nums">{size}</span> : null}
        <StatusBadge state={installed ? props.status.state : "manual"} />
        <OverflowMenu
          label={`${props.label} actions`}
          items={[
            {
              label: installed ? "Change binary…" : `Choose ${props.label} binary…`,
              icon: <FolderOpen />,
              onSelect: props.onPickFile
            },
            { label: "Copy install command", icon: <Copy />, onSelect: () => void copy() },
            installed && { label: "Forget path", icon: <Trash2 />, onSelect: props.onRemove, destructive: true }
          ]}
        />
      </div>
      {!installed ? (
        <div className={cn(well, "flex items-center gap-2 py-1 pl-3 pr-1")}>
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg-secondary">{instruction}</code>
          <IconButton
            label={copied ? "Copied" : "Copy install command"}
            icon={copied ? <Check /> : <Copy />}
            size="icon-xs"
            onClick={() => void copy()}
          />
        </div>
      ) : null}
    </div>
  );
}

const statusBadges: Record<EngineAssetStatus["state"] | "manual", { tone: "neutral" | "accent" | "info"; label: string }> = {
  installed: { tone: "accent", label: "Installed" },
  custom: { tone: "info", label: "Custom" },
  missing: { tone: "neutral", label: "Not installed" },
  manual: { tone: "neutral", label: "Manual install" }
};

function StatusBadge({ state }: { state: EngineAssetStatus["state"] | "manual" }) {
  const badge = statusBadges[state];
  return <Badge tone={badge.tone}>{badge.label}</Badge>;
}

/** Most recent GitHub lookup across assets, as a short local time; null if never checked. */
function latestCheckedAt(statuses: readonly EngineAssetStatus[]): string | null {
  const times = statuses.map((entry) => (entry.checkedAt ? Date.parse(entry.checkedAt) : Number.NaN)).filter(Number.isFinite);
  if (times.length === 0) return null;
  return new Date(Math.max(...times)).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
