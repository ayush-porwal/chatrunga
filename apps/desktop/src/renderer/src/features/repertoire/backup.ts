import type {
  BackupImportPreview,
  BackupImportPreviewRepertoire,
  RestoreBackupInput,
  RestoreBackupResult,
  RestoreBackupSelection
} from "@chaturanga/shared/types/repertoire";
import { plural } from "./repertoire-chapters";

/** How one previewed repertoire will be restored, as edited in the restore dialog. */
export type RestoreRowState = {
  sourceId: string;
  include: boolean;
  mode: RestoreBackupSelection["mode"];
  /** Only honoured when the backup has progress for this repertoire. */
  includeProgress: boolean;
  /** The name of a new copy as typed; blank falls back to the default. */
  newName: string;
};

export type RestoreRowAction =
  | { type: "reset"; preview: BackupImportPreview }
  | { type: "include"; sourceId: string; include: boolean }
  | { type: "mode"; sourceId: string; mode: RestoreBackupSelection["mode"] }
  | { type: "progress"; sourceId: string; includeProgress: boolean }
  | { type: "name"; sourceId: string; newName: string };

/** The name a restored copy gets when none is typed. */
export function defaultRestoredName(name: string): string {
  return `${name} (restored)`;
}

/** Every repertoire included as a new copy, with its progress when the backup has any. */
export function initialRestoreRows(preview: BackupImportPreview): RestoreRowState[] {
  return preview.repertoires.map((item) => ({
    sourceId: item.sourceId,
    include: true,
    mode: "new-copy",
    includeProgress: item.hasProgress,
    newName: defaultRestoredName(item.name)
  }));
}

/**
 * Applies one edit to the restore rows. The preview is consulted so a row can't be set to replace
 * a repertoire that doesn't exist here, nor to restore progress the backup doesn't have.
 */
export function restoreRowsReducer(
  preview: BackupImportPreview | null,
  rows: RestoreRowState[],
  action: RestoreRowAction
): RestoreRowState[] {
  if (action.type === "reset") return initialRestoreRows(action.preview);
  const source = preview?.repertoires.find((item) => item.sourceId === action.sourceId);
  if (!source) return rows;
  return rows.map((row) => {
    if (row.sourceId !== action.sourceId) return row;
    switch (action.type) {
      case "include":
        return { ...row, include: action.include };
      case "mode":
        return action.mode === "replace" && !source.existing ? row : { ...row, mode: action.mode };
      case "progress":
        return source.hasProgress ? { ...row, includeProgress: action.includeProgress } : row;
      case "name":
        return { ...row, newName: action.newName };
    }
  });
}

/**
 * The restore request for the included rows. Replacing sends the revision the user saw, or a
 * fresher one from `revisions` (keyed by the existing repertoire's id) after a stale-revision
 * failure; a new copy sends its trimmed name, or the default one when blank. A replace row whose
 * repertoire is missing here falls back to a new copy.
 */
export function buildRestoreInput(
  preview: BackupImportPreview,
  rows: readonly RestoreRowState[],
  revisions?: ReadonlyMap<string, number>
): RestoreBackupInput {
  const selections: RestoreBackupSelection[] = [];
  for (const row of rows) {
    if (!row.include) continue;
    const source = preview.repertoires.find((item) => item.sourceId === row.sourceId);
    if (!source) continue;
    const includeProgress = source.hasProgress && row.includeProgress;
    if (row.mode === "replace" && source.existing) {
      selections.push({
        sourceId: source.sourceId,
        mode: "replace",
        includeProgress,
        expectedRevision: revisions?.get(source.existing.id) ?? source.existing.revision
      });
    } else {
      selections.push({
        sourceId: source.sourceId,
        mode: "new-copy",
        includeProgress,
        newName: row.newName.trim() || defaultRestoredName(source.name)
      });
    }
  }
  return { jobId: preview.jobId, selections };
}

/** "512 B", "14.2 KB", "3.1 MB" (binary units, one decimal under 100). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) {
    return `${Math.max(0, Math.round(Number.isFinite(bytes) ? bytes : 0))} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 100 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** A long path cut to its start and file name ("/Users/me/…/backup.json"); short ones unchanged. */
export function shortenPath(path: string, max = 48): string {
  if (path.length <= max) return path;
  const separator = path.includes("\\") && !path.includes("/") ? "\\" : "/";
  const parts = path.split(separator);
  const file = parts.pop() ?? path;
  if (file.length + 2 >= max) return `…${file.slice(-(max - 1))}`;
  let head = "";
  for (const [index, part] of parts.entries()) {
    const next = index === 0 ? part : `${head}${separator}${part}`;
    if (next.length + file.length + 3 > max) break;
    head = next;
  }
  return `${head}${separator}…${separator}${file}`;
}

/** "3 repertoires · 12 chapters". */
export function backupSummary(items: readonly { chapterCount: number }[]): string {
  const chapters = items.reduce((total, item) => total + item.chapterCount, 0);
  return `${plural(items.length, "repertoire")} · ${plural(chapters, "chapter")}`;
}

/**
 * What replacing an existing repertoire changes: "+2 chapters · 1 changed · −0 · 5 decisions
 * changed · 40 progress entries". Progress is left out when it isn't being restored.
 */
export function restoreDiffLine(
  diff: NonNullable<BackupImportPreviewRepertoire["diff"]>,
  includeProgress: boolean
): string {
  const parts = [
    `+${plural(diff.chaptersAdded, "chapter")}`,
    `${diff.chaptersChanged} changed`,
    `−${diff.chaptersRemoved}`,
    `${plural(diff.decisionsChanged, "decision")} changed`
  ];
  if (includeProgress) {
    parts.push(
      `${diff.progressEntries} progress ${diff.progressEntries === 1 ? "entry" : "entries"}`
    );
  }
  return parts.join(" · ");
}

/** The preview's warnings as a notice (a title and its distinct lines), or null when none. */
export function backupWarningsNotice(
  warnings: readonly string[]
): { title: string; lines: string[] } | null {
  const lines = [...new Set(warnings.map((warning) => warning.trim()).filter(Boolean))];
  if (!lines.length) return null;
  return {
    title:
      lines.length === 1 ? "This backup has a warning" : `This backup has ${lines.length} warnings`,
    lines
  };
}

/** True for the main process's refusal of a replace whose expected revision is out of date. */
export function isStaleRevisionError(message: string): boolean {
  return /revision/i.test(message);
}

/** "“A”", "“A” and “B”", "“A”, “B” and “C”". */
function quotedList(names: readonly string[]): string {
  const quoted = names.map((name) => `“${name}”`);
  if (quoted.length <= 1) return quoted.join("");
  return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
}

/**
 * The success notice of a restore: the names as restored and, for replacements, where the replaced
 * repertoire's own backup was kept.
 */
export function restoreNotice(
  preview: BackupImportPreview,
  input: RestoreBackupInput,
  result: RestoreBackupResult
): { text: string; details: string[] } {
  const names = result.restored.map((item) => {
    const source = preview.repertoires.find((entry) => entry.sourceId === item.sourceId);
    const selection = input.selections.find((entry) => entry.sourceId === item.sourceId);
    if (item.mode === "replace") return source?.existing?.name ?? source?.name ?? "Repertoire";
    return selection?.newName ?? defaultRestoredName(source?.name ?? "Repertoire");
  });
  const details = result.restored.flatMap((item, index) =>
    item.mode === "replace" && item.retainedBackupPath
      ? [`Previous “${names[index]}” saved to ${shortenPath(item.retainedBackupPath)}`]
      : []
  );
  return { text: `Restored ${quotedList(names)}.`, details };
}
