import { useEffect, useState, type ReactNode } from "react";
import { Download, ExternalLink, Trash2 } from "lucide-react";
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
import { hasDesktopApi } from "@/lib/environment";
import { cardPadded, sectionTitle } from "@/lib/ui";
import { cn } from "@/lib/utils";

/** How long a finished download keeps showing "Download complete". */
const COMPLETED_PROGRESS_MS = 1800;

export function DatabasePage() {
  const databases = useDatabasesQuery();
  const downloadDatabase = useDownloadDatabaseMutation();
  const deleteDatabase = useDeleteDatabaseMutation();
  const desktopApiAvailable = hasDesktopApi();
  const [downloadProgress, setDownloadProgress] = useState<Record<string, DatabaseDownloadProgress>>({});
  const installedBySource = new Map(databases.data?.map((item) => [item.sourceId, item]) ?? []);

  useEffect(() => {
    const events = window.chaturanga?.events;
    if (!events) return;
    const clearTimers = new Set<number>();
    const unsubscribe = events.onDatabaseDownloadProgress((progress) => {
      setDownloadProgress((state) => ({ ...state, [progress.sourceId]: progress }));
      if (progress.state !== "completed") return;
      // Keep "Download complete" visible briefly, then drop the progress row.
      const timer = window.setTimeout(() => {
        clearTimers.delete(timer);
        setDownloadProgress((state) => {
          const next = { ...state };
          delete next[progress.sourceId];
          return next;
        });
      }, COMPLETED_PROGRESS_MS);
      clearTimers.add(timer);
    });
    return () => {
      unsubscribe();
      clearTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  async function removeDatabase(database: InstalledDatabase) {
    if (!desktopApiAvailable) return;
    if (!window.confirm(`Delete ${database.name}? The downloaded file will be removed from disk.`)) {
      return;
    }
    await deleteDatabase.mutateAsync(database.id);
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

      <div className="grid items-start gap-4 xl:grid-cols-2">
        {externalDatabaseSources.map((source) => {
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
              onDelete={(database) => void removeDatabase(database)}
            />
          );
        })}
      </div>
    </Page>
  );
}

function DatabaseCard({
  source,
  installed,
  progress,
  isDownloading,
  downloadDisabled,
  deleteDisabled,
  onDownload,
  onDelete
}: {
  source: ExternalDatabaseSource;
  installed: InstalledDatabase | undefined;
  progress: DatabaseDownloadProgress | undefined;
  isDownloading: boolean;
  downloadDisabled: boolean;
  deleteDisabled: boolean;
  onDownload: () => void;
  onDelete: (database: InstalledDatabase) => void;
}) {
  const records = installed?.recordCount ?? source.expectedRecords;
  const meta = [
    source.provider,
    source.format,
    records ? `${records.toLocaleString()} records` : null,
    source.updatedLabel ?? null,
    installed ? formatBytes(installed.fileSizeBytes) : null
  ].filter(Boolean);

  return (
    <article className={cn(cardPadded, "grid gap-3")}>
      <div className="grid gap-1">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className={sectionTitle}>{source.name}</h2>
            <Badge className="capitalize">{source.kind}</Badge>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {installed ? (
              <Badge tone="accent" className="mr-1.5">
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
        <p className="text-xs text-fg-subtle">{meta.join(" · ")}</p>
      </div>

      <p className="text-sm leading-6 text-fg-muted">{source.description}</p>

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

      {progress ? <DownloadProgress progress={progress} /> : null}

      {!installed ? (
        <Button
          type="button"
          variant="primary"
          className="justify-self-start"
          disabled={downloadDisabled}
          onClick={onDownload}
        >
          <Download />
          {isDownloading ? "Downloading…" : "Download"}
        </Button>
      ) : null}
    </article>
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

function DownloadProgress({ progress }: { progress: DatabaseDownloadProgress }) {
  const bytes = progress.totalBytes
    ? `${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)}`
    : formatBytes(progress.downloadedBytes);

  if (progress.state === "failed") {
    return (
      <Notice tone="danger" title="Download failed">
        {progress.message ?? bytes}
      </Notice>
    );
  }

  const status = progress.state === "completed" ? "Download complete" : "Downloading";
  return (
    <div className="grid gap-1.5">
      <Progress
        value={progress.state === "completed" ? 100 : progress.percent}
        aria-label={`${status}: ${bytes}`}
      />
      <div className="flex items-center justify-between gap-3 text-xs text-fg-muted">
        <span className="truncate">{progress.message ?? status}</span>
        <span className="shrink-0 tabular-nums">
          {bytes}
          {progress.percent === null ? "" : ` · ${progress.percent}%`}
        </span>
      </div>
    </div>
  );
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
