import type { Color } from "@chaturanga/shared/types/chess";
import type {
  DatabaseDownloadProgress,
  ExternalDatabaseSource,
  InstalledDatabase
} from "@chaturanga/shared/types/database";

/** The board picture on a database's card: a position of the kind the dataset holds. */
export type DatabaseSample = { fen: string; orientation: Color; lastMove: string };

const genericSample: DatabaseSample = {
  fen: "r2qr1k1/1b1nbppp/p2p1n2/1p2p3/3PP3/1BN1BN1P/PP3PP1/R2QR1K1 w - - 0 13",
  orientation: "white",
  lastMove: "f8e8"
};

const samples: Record<string, DatabaseSample> = {
  "lichess-puzzles": {
    fen: "2r3k1/pp3ppp/2n1b3/q3p3/4P3/1BN2Q2/PPP2PPP/3R2K1 b - - 2 19",
    orientation: "black",
    lastMove: "d3f3"
  },
  "chess-position-analysis-results": genericSample
};

export function databaseSample(sourceId: string): DatabaseSample {
  return samples[sourceId] ?? genericSample;
}

export type DatabaseFact = { label: string; value: string };

/**
 * The card's facts strip. Before a download: how many records the source has, its format and when
 * it was last updated; once downloaded: the records, the size on disk and the download date.
 * Unknown facts are left out rather than shown as dashes.
 */
export function databaseFacts(
  source: ExternalDatabaseSource,
  installed: InstalledDatabase | undefined
): DatabaseFact[] {
  const unit =
    source.kind === "puzzle" ? "Puzzles" : source.kind === "position" ? "Positions" : "Records";
  const records = installed?.recordCount ?? source.expectedRecords;
  const facts: (DatabaseFact | null)[] = installed
    ? [
        records ? { label: unit, value: compactCount(records) } : null,
        { label: "On disk", value: formatBytes(installed.fileSizeBytes) },
        { label: "Downloaded", value: formatDate(new Date(installed.downloadedAt)) }
      ]
    : [
        records ? { label: unit, value: `About ${compactCount(records)}` } : null,
        { label: "Format", value: source.format.toUpperCase() },
        source.updatedLabel ? { label: "Updated", value: formatIsoDate(source.updatedLabel) } : null
      ];
  return facts.filter((fact): fact is DatabaseFact => fact !== null);
}

/** What the card's one action row holds (it swaps contents; the card never changes height). */
export type DatabaseAction =
  | { kind: "download"; starting: boolean }
  | { kind: "downloading"; progress: DatabaseDownloadProgress }
  | { kind: "failed" }
  | { kind: "train" }
  | { kind: "none" };

export function databaseAction({
  source,
  installed,
  progress,
  starting
}: {
  source: ExternalDatabaseSource;
  installed: InstalledDatabase | undefined;
  progress: DatabaseDownloadProgress | undefined;
  /** A download of this source was asked for and its first progress hasn't arrived. */
  starting: boolean;
}): DatabaseAction {
  if (progress?.state === "downloading") return { kind: "downloading", progress };
  if (progress?.state === "failed") return { kind: "failed" };
  if (installed)
    return source.kind === "puzzle" || source.kind === "position"
      ? { kind: "train" }
      : { kind: "none" };
  // Finished, and the list of databases is being read again: the full bar until it shows up.
  if (progress?.state === "completed") return { kind: "downloading", progress };
  return { kind: "download", starting };
}

/** "Downloading… 112.7 MB of 268.4 MB, 42%" (main's own message, e.g. "Connecting…", first). */
export function downloadProgressText(progress: DatabaseDownloadProgress): string {
  const bytes = progress.totalBytes
    ? `${formatBytes(progress.downloadedBytes)} of ${formatBytes(progress.totalBytes)}`
    : formatBytes(progress.downloadedBytes);
  const percent = progress.percent === null ? "" : `, ${progress.percent}%`;
  return `${progress.message ?? "Downloading…"} ${bytes}${percent}`;
}

export function formatBytes(bytes: number): string {
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

/** 5939980 → "5.9M". */
function compactCount(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(
    value
  );
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** "2026-05-02" → "May 2, 2026"; anything else unchanged. */
function formatIsoDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return formatDate(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}
