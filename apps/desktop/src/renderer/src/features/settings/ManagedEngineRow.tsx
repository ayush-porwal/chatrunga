import { useEffect, useState } from "react";
import { Check, Copy, Download, FolderOpen, Loader2, RefreshCw, Trash2 } from "lucide-react";
import type { EngineAssetStatus } from "@chaturanga/shared/ipc/chaturanga-api";
import { useUpdateEngineMutation } from "../../queries/api";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { OverflowMenu } from "@/components/ui/menu";
import { formatSize, isAssetInstalled, type EngineListRow } from "@/lib/engine-assets";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { listRow, well } from "@/lib/ui";
import { cn } from "@/lib/utils";
import {
  EngineImagePreview,
  EngineRowText,
  savedEngineMenuItems,
  testSavedEngine,
  type TestResult
} from "./engine-row";

/**
 * A managed download in Settings → Engines (Stockfish, a Maia network, Lc0) together with the
 * "(managed)" engine the app keeps for it. A missing download shows a Download button; otherwise
 * the ⋯ menu holds Set as default / Test (once the engine exists), Update, and Remove download.
 * Managed engines can't be edited, renamed or deleted: the registry sync would undo it.
 *
 * Lc0 only runs Maia (no engine of its own). Where it has no download (macOS / Linux: upstream
 * publishes no binaries) the user installs it (e.g. Homebrew) and points the app at the binary;
 * while missing, the install command is shown under the row with a copy button.
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
  row: Extract<EngineListRow, { kind: "asset" }>;
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

  return (
    <div className="grid gap-1.5">
      <div
        className={cn(
          listRow,
          "relative transition-colors duration-standard",
          // Clips the progress bar to the rounded corners; only while busy, so the ⋯ menu isn't cut off.
          busy && "overflow-hidden border-line-strong"
        )}
      >
        <EngineImagePreview imagePath={engine?.imagePath ?? null} name={label} />
        <EngineRowText
          name={label}
          detail={installed ? status.installedVersion : null}
          badges={
            <>
              {engine?.isDefault ? <Badge tone="accent">Default</Badge> : null}
              {row.id === "lc0" ? <Badge>Runs Maia</Badge> : null}
            </>
          }
        />
        {size ? <span className="shrink-0 text-xs tabular-nums text-fg-subtle">{size}</span> : null}
        {busy ? (
          <Badge tone="warn" className="tabular-nums">
            {downloading ? `Downloading ${percent}%` : "Working…"}
          </Badge>
        ) : status.updateAvailable ? (
          <Badge tone="warn" title={`Latest release ${status.latestVersion ?? ""}`}>
            Update · {status.latestVersion}
          </Badge>
        ) : (
          <StatusBadge state={installed || !manual ? status.state : "manual"} />
        )}
        {busy ? (
          <span
            className="grid size-8 shrink-0 place-items-center text-fg-subtle"
            aria-label="Working"
          >
            <Loader2 className="size-4 animate-spin" />
          </span>
        ) : !installed && !manual ? (
          <IconButton label={`Download ${label}`} icon={<Download />} onClick={onDownload} />
        ) : (
          <OverflowMenu
            label={`${label} actions`}
            items={[
              ...(engine
                ? savedEngineMenuItems({
                    engine,
                    disabled: false,
                    onSetDefault: setDefault,
                    onTest: () => void test()
                  })
                : []),
              status.updateAvailable && {
                label: "Update",
                icon: <RefreshCw />,
                onSelect: onUpdate
              },
              !manual &&
                installed && {
                  label: "Remove download",
                  icon: <Trash2 />,
                  onSelect: onRemove,
                  destructive: true
                },
              manual && {
                label: installed ? "Change binary…" : `Choose ${label} binary…`,
                icon: <FolderOpen />,
                onSelect: onPickFile
              },
              manual && {
                label: "Copy install command",
                icon: <Copy />,
                onSelect: () => void copy()
              },
              manual &&
                installed && {
                  label: "Forget path",
                  icon: <Trash2 />,
                  onSelect: onRemove,
                  destructive: true
                }
            ]}
          />
        )}
        {busy ? (
          /* Row-wide progress along the bottom edge; scaleX so only a transform animates. */
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
        ) : null}
      </div>
      {manual && !installed ? (
        <div className={cn(well, "flex items-center gap-2 py-1 pl-3 pr-1")}>
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg-secondary">
            {instruction}
          </code>
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
