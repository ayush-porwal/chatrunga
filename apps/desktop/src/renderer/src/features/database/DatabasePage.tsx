import { useEffect, useState } from "react";
import { Database, Download, ExternalLink, Trash2 } from "lucide-react";
import { externalDatabaseSources } from "@chaturanga/shared/types/database";
import type { DatabaseDownloadProgress, InstalledDatabase } from "@chaturanga/shared/types/database";
import {
  useDatabasesQuery,
  useDeleteDatabaseMutation,
  useDownloadDatabaseMutation
} from "../../queries/api";
import { Button } from "@/components/ui/button";
import { hasDesktopApi } from "@/lib/environment";
import { cn } from "@/lib/utils";
import { empty } from "@/lib/ui";

export function DatabasePage() {
  const databases = useDatabasesQuery();
  const downloadDatabase = useDownloadDatabaseMutation();
  const deleteDatabase = useDeleteDatabaseMutation();
  const desktopApiAvailable = hasDesktopApi();
  const [downloadProgress, setDownloadProgress] = useState<Record<string, DatabaseDownloadProgress>>({});
  const installedBySource = new Map(databases.data?.map((item) => [item.sourceId, item]) ?? []);

  useEffect(() => {
    if (!window.chaturanga?.events) return;
    return window.chaturanga.events.onDatabaseDownloadProgress((progress) => {
      setDownloadProgress((state) => ({ ...state, [progress.sourceId]: progress }));
      if (progress.state === "completed") {
        window.setTimeout(() => {
          setDownloadProgress((state) => {
            const next = { ...state };
            delete next[progress.sourceId];
            return next;
          });
        }, 1800);
      }
    });
  }, []);

  async function removeDatabase(database: InstalledDatabase) {
    if (!desktopApiAvailable) return;
    if (!window.confirm(`Delete ${database.name}? The downloaded file will be removed from disk.`)) {
      return;
    }
    await deleteDatabase.mutateAsync(database.id);
  }

  return (
    <div className="mx-auto grid h-full w-full max-w-6xl content-start gap-7 overflow-auto px-8 py-8">
      <div className="grid gap-2">
        <h1 className="text-[26px] font-semibold tracking-[-0.01em] text-[#f4f1ea]">
          Databases
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-[#a9adb4]">
          Download optional datasets for puzzles, positions, and future game-library tools.
          Databases are stored locally and can be removed at any time.
        </p>
      </div>
      {!desktopApiAvailable ? (
        <div className="rounded-lg border border-[#d8ad5a]/25 bg-[#2b2418] px-3 py-2 text-sm leading-5 text-[#f1d7a6]">
          Database downloads and local file management require the desktop app.
        </div>
      ) : null}

      <section className="grid gap-3">
        <h2 className="text-[15px] font-semibold text-[#f4f1ea]">Available downloads</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {externalDatabaseSources.map((source) => {
            const installed = installedBySource.get(source.id);
            const progress = downloadProgress[source.id];
            const isDownloading =
              progress?.state === "downloading" ||
              (downloadDatabase.isPending && downloadDatabase.variables === source.id);
            return (
              <article
                key={source.id}
                className={cn(
                  "grid gap-4 rounded-[12px] border border-white/10 bg-[#181a1d]/95 bg-gradient-to-b from-white/[0.05] to-transparent p-4 shadow-[0_16px_44px_rgb(0_0_0/0.24)]",
                  installed && "border-[#8fb66f]/35"
                )}
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-[9px] border border-white/10 bg-[#263527] text-[#cce6b2]">
                    <Database size={19} />
                  </span>
                  <div className="grid min-w-0 gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-[16px] text-[#f4f1ea]">{source.name}</strong>
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#a9adb4]">
                        {source.kind}
                      </span>
                    </div>
                    <p className="text-[13px] leading-5 text-[#a9adb4]">{source.description}</p>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-[12px] text-[#a9adb4] sm:grid-cols-4">
                  <Meta label="Provider" value={source.provider} />
                  <Meta label="Format" value={source.format} />
                  <Meta
                    label="Records"
                    value={source.expectedRecords ? source.expectedRecords.toLocaleString() : "Unknown"}
                  />
                  <Meta label="Updated" value={source.updatedLabel ?? "Repository"} />
                </dl>
                <div className="grid gap-2 rounded-lg border border-white/10 bg-[#151719] p-3">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#727982]">
                    Supported filters
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {source.supportedFilters.map((field) => (
                      <span
                        key={field}
                        className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-[#d8dbe0]"
                      >
                        {field}
                      </span>
                    ))}
                  </div>
                </div>
                {installed ? (
                  <div className="rounded-lg border border-[#8fb66f]/25 bg-[#263527]/45 px-3 py-2 text-[12px] text-[#d7e8c5]">
                    Downloaded · {formatBytes(installed.fileSizeBytes)}
                  </div>
                ) : null}
                {progress ? <DownloadProgress progress={progress} /> : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant={installed ? "outline" : "secondary"}
                    disabled={!desktopApiAvailable || downloadDatabase.isPending}
                    onClick={() => downloadDatabase.mutate(source.id)}
                  >
                    <Download size={16} />
                    {isDownloading ? "Downloading..." : installed ? "Download again" : "Download database"}
                  </Button>
                  <Button type="button" variant="outline" asChild>
                    <a href={source.pageUrl} target="_blank" rel="noreferrer">
                      <ExternalLink size={16} />
                      Source
                    </a>
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="grid gap-3">
        <h2 className="text-[15px] font-semibold text-[#f4f1ea]">Downloaded databases</h2>
        {databases.data?.length ? (
          <div className="grid gap-2">
            {databases.data.map((database) => (
              <div
                key={database.id}
                className="grid gap-3 rounded-[10px] border border-white/10 bg-[#181a1d]/95 p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="grid min-w-0 gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-[#f4f1ea]">{database.name}</strong>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-[#a9adb4]">
                      {database.kind} · {database.format}
                    </span>
                  </div>
                  <span className="truncate text-[12px] text-[#a9adb4]">{database.filePath}</span>
                  <span className="text-[12px] text-[#a9adb4]">
                    {formatBytes(database.fileSizeBytes)}
                    {database.recordCount ? ` · ${database.recordCount.toLocaleString()} records` : ""}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={!desktopApiAvailable || deleteDatabase.isPending}
                  onClick={() => void removeDatabase(database)}
                >
                  <Trash2 size={16} />
                  Delete
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className={empty}>Downloaded databases will appear here.</p>
        )}
      </section>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 rounded-lg border border-white/10 bg-[#151719] px-2.5 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.04em] text-[#727982]">
        {label}
      </dt>
      <dd className="truncate text-[#f4f1ea]">{value}</dd>
    </div>
  );
}

function DownloadProgress({ progress }: { progress: DatabaseDownloadProgress }) {
  const percent = progress.percent ?? 0;
  return (
    <div className="grid gap-2 rounded-lg border border-[#8fb66f]/25 bg-[#151d17] p-3">
      <div className="flex items-center justify-between gap-3 text-[12px]">
        <strong className="text-[#f4f1ea]">
          {progress.state === "completed"
            ? "Download complete"
            : progress.state === "failed"
              ? "Download failed"
              : "Downloading"}
        </strong>
        <span className="text-[#a9adb4]">
          {progress.totalBytes
            ? `${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)}`
            : formatBytes(progress.downloadedBytes)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#2a3035]">
        <div
          className="h-full rounded-full bg-[#8fb66f] transition-[width]"
          style={{ width: progress.percent === null ? "35%" : `${percent}%` }}
        />
      </div>
      <div className="flex items-center justify-between gap-3 text-[11px] text-[#a9adb4]">
        <span>{progress.message ?? "Large downloads can take a while."}</span>
        <strong className="text-[#d7e8c5]">
          {progress.percent === null ? "Size unknown" : `${progress.percent}%`}
        </strong>
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
