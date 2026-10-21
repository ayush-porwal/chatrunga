import { useEffect, useState } from "react";
import { Check, Copy, Download, FolderOpen, Loader2, RefreshCw, Trash2 } from "lucide-react";
import type { EngineAssetStatus } from "@chaturanga/shared/ipc/chaturanga-api";
import { useUpdateEngineMutation } from "../../queries/api";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { OverflowMenu, type MenuItem } from "@/components/ui/menu";
import { formatSize, isAssetInstalled, type EngineListRow } from "@/lib/engine-assets";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { listRow, well } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { EngineAvatar } from "../analysis/EngineAvatar";
import {
  EngineRowText,
  savedEngineMenuItems,
  testSavedEngine,
  type TestResult
} from "./engine-row";

type AssetRow = Extract<EngineListRow, { kind: "asset" }>;

/**
 * A managed download in Settings → Engines (Stockfish, Lc0, Lc0's network, a Maia network)
 * together with the "(managed)" engine the app keeps for it. A missing download shows a Download
 * button; otherwise the ⋯ menu holds Set as default / Test (once the engine exists), Update, and
 * Remove download. Managed engines can't be edited, renamed or deleted: the registry sync would
 * undo it.
 *
 * Lc0 is an engine of its own (playing with its network, the row under it) and also runs Maia.
 * Where it has no download (macOS / Linux: upstream publishes no binaries) the user installs it
 * (e.g. Homebrew) and points the app at the binary; while missing, the install command is shown
 * under the row with a copy button. The network row downloads LCZero's recommended network, or
 * takes the user's own `.pb` / `.pb.gz` file instead.
 */
export function ManagedEngineRow({
  row,
  busy,
  percent,
  onDownload,
  onUpdate,
  onRemove,
  onPickFile,
  onResult
}: {
  row: AssetRow;
  busy: boolean;
  percent: number;
  onDownload: () => void;
  onUpdate: () => void;
  onRemove: () => void;
  onPickFile: () => void;
  onResult: (result: TestResult) => void;
}) {
  const { status, engine, label } = row;
  const updateEngine = useUpdateEngineMutation();
  const installed = isAssetInstalled(status);
  const manual = !status.autoDownload;
  const network = row.id === "lc0-network";
  const size = formatSize(installed ? status.sizeBytes : manual ? null : status.downloadSizeBytes);
  const downloading = busy && percent > 0 && percent < 100;
  const instruction =
    status.installInstructions ?? "Install Lc0 from https://lczero.org/play/download/";
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [copied]);
  // A refused clipboard write leaves the command selectable in the well below.
  const copy = () =>
    navigator.clipboard.writeText(instruction).then(
      () => setCopied(true),
      () => undefined
    );

  const test = async () => {
    if (!engine) return;
    const outcome = await testSavedEngine(engine, label);
    if (outcome) onResult(outcome.result);
  };
  const setDefault = () => {
    if (!engine) return;
    updateEngine.mutate(
      { id: engine.id, patch: { isDefault: true } },
      {
        onError: (error) =>
          onResult({
            ok: false,
            message: `Couldn't set the default engine: ${ipcErrorMessage(error) || "unknown error"}`
          })
      }
    );
  };
  const menuItems = (): (MenuItem | false)[] => [
    ...(engine
      ? savedEngineMenuItems({
          engine,
          disabled: false,
          onSetDefault: setDefault,
          onTest: () => void test()
        })
      : []),
    ...(network
      ? networkMenuItems({ status, onDownload, onRemove, onPickFile })
      : assetMenuItems({
          status,
          label,
          onUpdate,
          onRemove,
          onPickFile,
          onCopy: () => void copy()
        }))
  ];

  return (
    <div className="grid gap-1.5">
      <div
        className={cn(
          listRow,
          "relative transition-colors duration-standard",
          // Lc0's network belongs to the Lc0 row above it.
          network && "ml-6",
          // Clips the progress bar to the rounded corners; only while busy, so the ⋯ menu isn't cut off.
          busy && "overflow-hidden border-line-strong"
        )}
      >
        <ManagedEngineName row={row} />
        {size ? <span className="shrink-0 text-xs tabular-nums text-fg-subtle">{size}</span> : null}
        <ManagedEngineBadge
          status={status}
          busy={busy}
          downloading={downloading}
          percent={percent}
        />
        {busy ? (
          <span
            className="grid size-8 shrink-0 place-items-center text-fg-subtle"
            aria-label="Working"
          >
            <Loader2 className="size-4 animate-spin" />
          </span>
        ) : (
          <RowActions row={row} menuItems={menuItems} onDownload={onDownload} />
        )}
        {busy ? <BusyProgress downloading={downloading} percent={percent} /> : null}
      </div>
      {manual && !installed ? (
        <InstallCommand instruction={instruction} copied={copied} onCopy={() => void copy()} />
      ) : null}
    </div>
  );
}

/**
 * A missing download's Download button, then the ⋯ menu once there is something in it. A missing
 * network keeps its menu too: it can be the user's own file instead.
 */
function RowActions({
  row,
  menuItems,
  onDownload
}: {
  row: AssetRow;
  menuItems: () => (MenuItem | false)[];
  onDownload: () => void;
}) {
  const installed = isAssetInstalled(row.status);
  const manual = !row.status.autoDownload;
  return (
    <>
      {!installed && !manual ? (
        <IconButton label={`Download ${row.label}`} icon={<Download />} onClick={onDownload} />
      ) : null}
      {installed || manual || row.id === "lc0-network" ? (
        <OverflowMenu label={`${row.label} actions`} items={menuItems()} />
      ) : null}
    </>
  );
}

/** The download's picture, name, installed version and badges. */
function ManagedEngineName({ row }: { row: AssetRow }) {
  const { status, engine, label } = row;
  return (
    <>
      <EngineAvatar engine={engine ?? { name: label }} size="md" label={`${label} engine image`} />
      <EngineRowText
        name={label}
        detail={
          row.id === "lc0-network"
            ? networkName(status)
            : isAssetInstalled(status)
              ? status.installedVersion
              : null
        }
        badges={
          <>
            {engine?.isDefault ? <Badge tone="accent">Default</Badge> : null}
            {row.id === "lc0" ? <Badge>Also runs Maia</Badge> : null}
          </>
        }
      />
    </>
  );
}

/** Work in progress (with the download's percentage), an available update, or the install state. */
function ManagedEngineBadge({
  status,
  busy,
  downloading,
  percent
}: {
  status: EngineAssetStatus;
  busy: boolean;
  downloading: boolean;
  percent: number;
}) {
  if (busy) {
    return (
      <Badge tone="warn" className="tabular-nums">
        {downloading ? `Downloading ${percent}%` : "Working…"}
      </Badge>
    );
  }
  if (status.updateAvailable) {
    return (
      <Badge tone="warn" title={`Latest release ${status.latestVersion ?? ""}`}>
        Update · {status.latestVersion}
      </Badge>
    );
  }
  // Not installed and no download: the user installs it.
  const state = isAssetInstalled(status) || status.autoDownload ? status.state : "manual";
  return <StatusBadge state={state} />;
}

/**
 * The ⋯ menu's entries for the download itself: Update when a release is out, then Remove download
 * for a downloaded one, or, for a manual install, choosing the binary, copying the install command
 * and (once set) forgetting the path.
 */
function assetMenuItems({
  status,
  label,
  onUpdate,
  onRemove,
  onPickFile,
  onCopy
}: {
  status: EngineAssetStatus;
  label: string;
  onUpdate: () => void;
  onRemove: () => void;
  onPickFile: () => void;
  onCopy: () => void;
}): (MenuItem | false)[] {
  const installed = isAssetInstalled(status);
  const update = status.updateAvailable && {
    label: "Update",
    icon: <RefreshCw />,
    onSelect: onUpdate
  };
  if (status.autoDownload) {
    return [
      update,
      installed && {
        label: "Remove download",
        icon: <Trash2 />,
        onSelect: onRemove,
        destructive: true
      }
    ];
  }
  return [
    update,
    {
      label: installed ? "Change binary…" : `Choose ${label} binary…`,
      icon: <FolderOpen />,
      onSelect: onPickFile
    },
    { label: "Copy install command", icon: <Copy />, onSelect: onCopy },
    installed && { label: "Forget path", icon: <Trash2 />, onSelect: onRemove, destructive: true }
  ];
}

/** The network Lc0 plays with: the user's own file's name, else the default network's. */
function networkName(status: EngineAssetStatus): string | null {
  if (status.state === "custom" && status.customPath)
    return status.customPath.split(/[\\/]/).pop() ?? status.customPath;
  return status.installedVersion ?? status.latestVersion;
}

/**
 * Lc0's network's ⋯ menu: choose the user's own network file, go back to the default network
 * (downloading it) from a custom one, and Remove download / Forget network file.
 */
function networkMenuItems({
  status,
  onDownload,
  onRemove,
  onPickFile
}: {
  status: EngineAssetStatus;
  onDownload: () => void;
  onRemove: () => void;
  onPickFile: () => void;
}): (MenuItem | false)[] {
  const custom = status.state === "custom";
  return [
    {
      label: custom ? "Choose another network file…" : "Choose network file…",
      icon: <FolderOpen />,
      onSelect: onPickFile
    },
    custom && { label: "Use default network", icon: <Download />, onSelect: onDownload },
    status.state === "installed" && {
      label: "Remove download",
      icon: <Trash2 />,
      onSelect: onRemove,
      destructive: true
    },
    custom && {
      label: "Forget network file",
      icon: <Trash2 />,
      onSelect: onRemove,
      destructive: true
    }
  ];
}

/** Row-wide progress along the bottom edge; scaleX so only a transform animates. */
function BusyProgress({ downloading, percent }: { downloading: boolean; percent: number }) {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-x-0 bottom-0 h-0.5 animate-fade-in overflow-hidden bg-accent/10"
    >
      {downloading ? (
        <span
          className="block h-full origin-left bg-accent transition-transform duration-standard ease-standard"
          style={{ transform: `scaleX(${percent / 100})` }}
        />
      ) : (
        <span className="block h-full w-1/3 animate-indeterminate bg-accent/70" />
      )}
    </span>
  );
}

/** A manual install's command, under the row, with a copy button. */
function InstallCommand({
  instruction,
  copied,
  onCopy
}: {
  instruction: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className={cn(well, "flex items-center gap-2 py-1 pl-3 pr-1")}>
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg-secondary">
        {instruction}
      </code>
      <IconButton
        label={copied ? "Copied" : "Copy install command"}
        icon={copied ? <Check /> : <Copy />}
        size="icon-xs"
        onClick={onCopy}
      />
    </div>
  );
}

const statusBadges: Record<
  EngineAssetStatus["state"] | "manual",
  { tone: "neutral" | "accent" | "info"; label: string }
> = {
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
export function latestCheckedAt(statuses: readonly EngineAssetStatus[]): string | null {
  const times = statuses
    .map((entry) => (entry.checkedAt ? Date.parse(entry.checkedAt) : Number.NaN))
    .filter(Number.isFinite);
  if (times.length === 0) return null;
  return new Date(Math.max(...times)).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}
