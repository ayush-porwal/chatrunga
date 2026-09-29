import { memo, useState, type ReactNode } from "react";
import { Check, Download, ExternalLink, Loader2, Play, RotateCcw, Trash2, X } from "lucide-react";
import { externalDatabaseSources } from "@chaturanga/shared/types/database";
import type {
  DatabaseDownloadProgress,
  ExternalDatabaseSource,
  InstalledDatabase
} from "@chaturanga/shared/types/database";
import {
  useDatabasesQuery,
  useDeleteDatabaseMutation,
  useDownloadDatabaseMutation
} from "../../queries/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { OverflowMenu } from "@/components/ui/menu";
import { Notice } from "@/components/ui/notice";
import { Page, PageHeader } from "@/components/ui/page";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { hasDesktopApi } from "@/lib/environment";
import { cardPadded, sectionTitle } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useDownloadStore } from "../../stores/download-store";

export const DatabasePage = memo(function DatabasePage({ onTrain }: { onTrain: (databaseId: string) => void }) {
  const databases = useDatabasesQuery();
  const downloadDatabase = useDownloadDatabaseMutation();
  const deleteDatabase = useDeleteDatabaseMutation();
  const desktopApiAvailable = hasDesktopApi();
  // Kept for the whole app (useDatabaseDownloads): a download started earlier still shows here.
  const downloadProgress = useDownloadStore((state) => state.progress);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const installedBySource = new Map(databases.data?.map((item) => [item.sourceId, item]) ?? []);

  async function removeDatabase(database: InstalledDatabase) {
    if (!desktopApiAvailable) return;
    if (!window.confirm(`Delete ${database.name}? The downloaded file will be removed from disk.`)) {
      return;
    }
    setDeleteError(null);
    try {
      await deleteDatabase.mutateAsync(database.id);
    } catch (error) {
      setDeleteError(`Couldn't delete ${database.name}: ${ipcErrorMessage(error) || "unknown error"}`);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Databases"
        description="Optional datasets for puzzle training, stored on this computer."
      />
      {!desktopApiAvailable ? (
        <Notice tone="warn">Database downloads and local file management require the desktop app.</Notice>
      ) : null}
      {databases.isError ? (
        <Notice
          tone="danger"
          title="Couldn't read your databases"
          action={
            <Button type="button" variant="outline" size="xs" onClick={() => void databases.refetch()}>
              <RotateCcw />
              Try again
            </Button>
          }
        >
          {ipcErrorMessage(databases.error) || "The list of installed databases couldn't be loaded."}
        </Notice>
      ) : null}
      {deleteError ? <Notice tone="danger">{deleteError}</Notice> : null}

      <div className="grid items-start gap-4 xl:grid-cols-2">
        {databases.isPending && desktopApiAvailable
          ? externalDatabaseSources.map((source) => <DatabaseCardSkeleton key={source.id} />)
          : externalDatabaseSources.map((source) => {
          const progress = downloadProgress[source.id];
          const isDownloading =
            progress?.state === "downloading" ||
            (downloadDatabase.isPending && downloadDatabase.variables === source.id);
          return (
            <DatabaseCard
              key={source.id}
              source={source}
              installed={installedBySource.get(source.id)}
              progress={progress}
              isDownloading={isDownloading}
              downloadDisabled={!desktopApiAvailable || downloadDatabase.isPending}
              deleteDisabled={!desktopApiAvailable || deleteDatabase.isPending}
              onDownload={() => downloadDatabase.mutate(source.id)}
              onCancel={() => void window.chaturanga?.databases.cancelDownload(source.id)}
              onDelete={(database) => void removeDatabase(database)}
              onTrain={onTrain}
            />
          );
            })}
      </div>
    </Page>
  );
});

function DatabaseCard({
  source,
  installed,
  progress,
  isDownloading,
  downloadDisabled,
  deleteDisabled,
  onDownload,
  onCancel,
  onDelete,
  onTrain
}: {
  source: ExternalDatabaseSource;
  installed: InstalledDatabase | undefined;
  progress: DatabaseDownloadProgress | undefined;
  isDownloading: boolean;
  downloadDisabled: boolean;
  deleteDisabled: boolean;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: (database: InstalledDatabase) => void;
  onTrain: (databaseId: string) => void;
}) {
  const records = installed?.recordCount ?? source.expectedRecords;
  const unit = source.kind === "puzzle" ? "puzzles" : source.kind === "position" ? "positions" : "records";
  const allFacts = installed
    ? [
        { label: unit[0].toUpperCase() + unit.slice(1), value: records ? records.toLocaleString() : "—" },
        { label: "On disk", value: formatBytes(installed.fileSizeBytes) },
        { label: "Downloaded", value: new Date(installed.downloadedAt).toLocaleDateString(undefined, { dateStyle: "medium" }) }
      ]
    : [
        { label: unit[0].toUpperCase() + unit.slice(1), value: records ? `About ${compactCount(records)}` : "—" },
        { label: "Format", value: source.format.toUpperCase() },
        { label: "Updated", value: source.updatedLabel ? formatIsoDate(source.updatedLabel) : "—" }
      ];
  // Unknown facts are left out rather than shown as dashes.
  const facts = allFacts.filter((fact) => fact.value !== "—");

  return (
    <article className={cn(cardPadded, "grid gap-4 transition-colors duration-standard", installed && "border-accent/20")}>
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className={cn(sectionTitle, "truncate")} title={source.name}>
              {source.name}
            </h2>
            <Badge className="capitalize">{source.kind}</Badge>
          </div>
          <p className="truncate text-xs text-fg-subtle">
            {source.provider}, {source.license}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {installed ? (
            <Badge tone="accent" className="mr-1.5 animate-pop-in">
              <Check />
              Downloaded
            </Badge>
          ) : null}
          <IconLink label="Source page" href={source.pageUrl} icon={<ExternalLink />} />
          {installed ? (
            <OverflowMenu
              label={`${source.name} actions`}
              items={[
                {
                  label: isDownloading ? "Downloading…" : "Download again",
                  icon: <Download />,
                  onSelect: onDownload,
                  disabled: downloadDisabled
                },
                {
                  label: "Delete",
                  icon: <Trash2 />,
                  onSelect: () => onDelete(installed),
                  disabled: deleteDisabled,
                  destructive: true
                }
              ]}
            />
          ) : null}
        </div>
      </div>

      <p className="text-sm leading-6 text-fg-muted">{source.description}</p>

      <dl className="grid grid-cols-3 gap-4 border-y border-line-subtle py-3 empty:hidden">
        {facts.map((fact) => (
          <div key={fact.label} className="grid min-w-0 gap-0.5">
            <dt className="text-xs text-fg-subtle">{fact.label}</dt>
            <dd className="truncate text-sm font-medium tabular-nums text-fg-secondary" title={fact.value}>
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>

      {installed ? (
        <p className="truncate font-mono text-2xs text-fg-subtle" title={installed.filePath}>
          {installed.filePath}
        </p>
      ) : null}

      <Disclosure title="Supported filters" summary={`${source.supportedFilters.length}`}>
        <div className="flex flex-wrap gap-1.5">
          {source.supportedFilters.map((field) => (
            <Badge key={field}>{field}</Badge>
          ))}
        </div>
      </Disclosure>

      {progress ? (
        <DownloadProgress progress={progress} onRetry={downloadDisabled ? undefined : onDownload} onCancel={onCancel} />
      ) : null}

      {installed && (source.kind === "puzzle" || source.kind === "position") && progress?.state !== "downloading" ? (
        <Button type="button" variant="primary" className="justify-self-start" onClick={() => onTrain(installed.id)}>
          <Play />
          Train with this dataset
        </Button>
      ) : null}

      {!installed && progress?.state !== "downloading" && progress?.state !== "failed" ? (
        <Button
          type="button"
          variant="primary"
          className="justify-self-start"
          disabled={downloadDisabled}
          onClick={onDownload}
        >
          {isDownloading ? <Loader2 className="animate-spin" /> : <Download />}
          {isDownloading ? "Starting download…" : "Download"}
        </Button>
      ) : null}
    </article>
  );
}

function DatabaseCardSkeleton() {
  return (
    <div className={cn(cardPadded, "grid gap-4")} aria-hidden="true">
      <div className="grid gap-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="grid gap-2">
        <Skeleton className="h-3" />
        <Skeleton className="h-3 w-4/5" />
      </div>
      <div className="grid grid-cols-3 gap-4 border-y border-line-subtle py-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="grid gap-1.5">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
      <Skeleton className="h-9 w-32 rounded-lg" />
    </div>
  );
}

/**
 * Icon-only external link styled like <IconButton> (ghost, tooltip + aria-label).
 * Local because IconButton renders a <button>; candidate for components/ui.
 */
function IconLink({ label, href, icon }: { label: string; href: string; icon: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild variant="ghost" size="icon-sm">
          <a href={href} target="_blank" rel="noreferrer" aria-label={label}>
            {icon}
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function DownloadProgress({
  progress,
  onRetry,
  onCancel
}: {
  progress: DatabaseDownloadProgress;
  onRetry?: () => void;
  onCancel: () => void;
}) {
  const bytes = progress.totalBytes
    ? `${formatBytes(progress.downloadedBytes)} of ${formatBytes(progress.totalBytes)}`
    : formatBytes(progress.downloadedBytes);

  if (progress.state === "failed") {
    return (
      <Notice
        tone="danger"
        title="Download failed"
        className="animate-rise-in"
        action={
          onRetry ? (
            <Button type="button" variant="outline" size="xs" onClick={onRetry}>
              <RotateCcw />
              Try again
            </Button>
          ) : undefined
        }
      >
        {progress.message ?? bytes}
      </Notice>
    );
  }

  if (progress.state === "completed") {
    return (
      <Notice tone="success" className="animate-rise-in">
        Download complete. It’s ready to use in Puzzles.
      </Notice>
    );
  }

  return (
    <div className="grid animate-fade-in gap-1.5">
      <Progress value={progress.percent} aria-label={`Downloading: ${bytes}`} />
      <div className="flex items-center justify-between gap-3 text-xs text-fg-muted">
        <span className="truncate">{progress.message ?? "Downloading…"}</span>
        <span className="flex shrink-0 items-center gap-2 tabular-nums">
          {bytes}
          {progress.percent === null ? "" : `, ${progress.percent}%`}
          <Button type="button" variant="ghost" size="xs" onClick={onCancel}>
            <X />
            Cancel
          </Button>
        </span>
      </div>
    </div>
  );
}

/** "2026-05-02" → "May 2, 2026"; anything else unchanged. */
function formatIsoDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** 5939980 → "5.9M". */
function compactCount(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}
