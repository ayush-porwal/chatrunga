/** Native repertoire backups (design §10): export, preview and restore. */
import { app, BrowserWindow, dialog } from "electron";
import { nanoid } from "nanoid";
import { open, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  type BackupImportPreview,
  type ExportBackupInput,
  type ExportBackupResult,
  type PreviewBackupImportInput,
  type RepertoireBackupDocument,
  type RepertoireBackupEntry,
  type RestoreBackupInput,
  type RestoreBackupResult
} from "@chaturanga/shared/types/repertoire";
import {
  DEFAULT_BACKUP_LIMITS,
  diffBackupEntry,
  stripForExport,
  validateBackupDocument
} from "@chaturanga/shared/chess/repertoire-backup";
import { databasePath } from "../db";
import {
  backupDocument,
  backupEntryOf,
  RETAINED_BACKUP_DIR,
  restoreRefusal,
  type BackupAppInfo
} from "./backup-restore";
import { runBackupRestore } from "./backup-restore-runner";
import { repertoireRepository, transaction } from "./repository";
import { sessionRepository } from "./practice-repository";
import { IMPORT_JOB_TTL_MS, MAX_IMPORT_JOBS, changed, clock } from "./service-runtime";

/** A previewed backup: its validated document, and its text for the restore worker. */
type BackupJob = {
  document: RepertoireBackupDocument;
  text: string;
  warnings: string[];
  expiresAt: number;
};
const backupJobs = new Map<string, BackupJob>();
const MAX_BACKUP_BYTES = DEFAULT_BACKUP_LIMITS.maxBytes;
const BACKUP_FILTERS = [{ name: "Chaturanga backup", extensions: ["json"] }];

function mib(bytes: number): string {
  return `${Math.ceil((bytes / (1024 * 1024)) * 10) / 10} MiB`;
}

/**
 * The app's own version. Unpackaged, Electron may report its own version instead, so the version
 * the package script runs with (apps/desktop/package.json) is used when it is set.
 */
function appVersion(): string {
  if (app.isPackaged) return app.getVersion();
  return process.env.npm_package_version || app.getVersion();
}

/** This app, as the writer a backup document names. */
function backupApp(): BackupAppInfo {
  return { name: app.getName(), version: appVersion() };
}

/** One warning per damaged chapter of the entry, saying it was written as raw data. */
function damagedChapterWarnings(entry: RepertoireBackupEntry): string[] {
  return entry.chapters.flatMap((chapter) =>
    chapter.damaged
      ? [
          `Repertoire "${entry.repertoire.name}": chapter "${chapter.title}" is damaged (${chapter.damaged.reason}); its stored data was written as is and can't be restored`
        ]
      : []
  );
}

/** `yyyy-mm-dd` in local time, for the suggested file name. */
function localDate(time: number): string {
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Writes `text` to `<path>.tmp`, syncs it to disk and renames it over `path`, so a crash never
 * leaves a half-written file at the destination. The temporary file is removed on failure.
 */
async function writeFileAtomically(path: string, text: string): Promise<void> {
  const temporary = `${path}.tmp`;
  try {
    const handle = await open(temporary, "w");
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Writes a native backup of the chosen repertoires (all of them, archived included, by default)
 * through a save dialog. The snapshot is read in one transaction, so every repertoire is exported
 * at one captured revision; progress is included only when asked. A damaged chapter is written as
 * its raw stored data with a warning. The destination is only ever the path the user picked in the
 * dialog, written atomically. `savedPath` is null when the dialog was cancelled.
 */
export async function exportBackup(
  input: ExportBackupInput,
  owner: BrowserWindow | null = null
): Promise<ExportBackupResult> {
  const now = clock();
  const entries = transaction(() => {
    const ids = input.repertoireIds ?? repertoireRepository.ids();
    return [...new Set(ids)].map((id) => {
      const record = repertoireRepository.get(id);
      if (!record) throw new Error(`Invalid repertoireIds: "${id}" is not in this library`);
      return stripForExport(backupEntryOf(record), input.includeProgress);
    });
  }, "read");
  if (!entries.length) throw new Error("Invalid export: there are no repertoires to back up");
  const warnings = entries.flatMap(damagedChapterWarnings);
  const json = JSON.stringify(backupDocument(entries, now, backupApp()));
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes > MAX_BACKUP_BYTES) {
    throw new Error(
      `Invalid export: the backup would be ${mib(bytes)}, over the ${mib(MAX_BACKUP_BYTES)} a restore accepts; back up fewer repertoires at once`
    );
  }
  // The restore's own checks (repertoire, chapter and move counts too): a backup that couldn't be
  // restored isn't written.
  const unrestorable = restoreRefusal(json);
  if (unrestorable) {
    throw new Error(
      `Invalid export: the backup couldn't be restored (${unrestorable}); back up fewer repertoires at once`
    );
  }
  const window = owner ?? BrowserWindow.getFocusedWindow();
  const options = {
    defaultPath: `chaturanga-repertoires-${localDate(now)}.json`,
    filters: BACKUP_FILTERS
  };
  const choice = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options);
  if (choice.canceled || !choice.filePath) {
    return { savedPath: null, repertoireCount: entries.length, bytes, warnings };
  }
  await writeFileAtomically(choice.filePath, json);
  return { savedPath: choice.filePath, repertoireCount: entries.length, bytes, warnings };
}

function pruneBackupJobs(now: number): void {
  for (const [jobId, job] of backupJobs) if (job.expiresAt <= now) backupJobs.delete(jobId);
}

function requireBackupJob(jobId: string, now: number): BackupJob {
  pruneBackupJobs(now);
  const job = backupJobs.get(jobId);
  if (!job) {
    throw new Error(
      "Invalid jobId: the backup preview expired or was cancelled; choose the file again"
    );
  }
  return job;
}

/** The backup text from the native open dialog (size checked before reading), or null. */
async function pickBackupFile(owner: BrowserWindow | null): Promise<string | null> {
  const window = owner ?? BrowserWindow.getFocusedWindow();
  const options: Electron.OpenDialogOptions = {
    properties: ["openFile"],
    filters: BACKUP_FILTERS
  };
  const choice = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  const path = choice.canceled ? undefined : choice.filePaths[0];
  if (!path) return null;
  const { size } = await stat(path);
  if (size > MAX_BACKUP_BYTES) {
    throw new Error(
      `Invalid backup: the file is ${mib(size)}; backups up to ${mib(MAX_BACKUP_BYTES)} can be restored`
    );
  }
  return readFile(path, "utf8");
}

/**
 * The preview of a job: each backup repertoire against a repertoire with the same id in this
 * library, if any, with the diff replacing it would make. An existing repertoire with a damaged
 * chapter has no diff and is flagged `damaged` (it can still be replaced or restored as a copy).
 */
function previewOf(jobId: string, job: BackupJob): BackupImportPreview {
  const repertoires = transaction(
    () =>
      job.document.repertoires.map((entry) => {
        const record = repertoireRepository.get(entry.repertoire.id);
        const current = record ? backupEntryOf(record) : null;
        const damaged = Boolean(current?.chapters.some((chapter) => chapter.damaged));
        return {
          sourceId: entry.repertoire.id,
          name: entry.repertoire.name,
          color: entry.repertoire.color,
          chapterCount: entry.chapters.length,
          decisionCount: entry.decisions.length,
          hasProgress: (entry.progress?.length ?? 0) > 0,
          existing: record
            ? { id: record.id, name: record.name, revision: record.revision, color: record.color }
            : null,
          diff:
            record && current && !damaged
              ? diffBackupEntry(current, entry, {
                  sessionCount: sessionRepository.count(record.id)
                })
              : null,
          ...(damaged ? { damaged: true } : {})
        };
      }),
    "read"
  );
  return {
    jobId,
    formatVersion: job.document.formatVersion,
    exportedAt: job.document.exportedAt,
    app: job.document.app,
    repertoires,
    warnings: job.warnings
  };
}

/**
 * Validates a backup (picked through the native open dialog, or given as JSON text) and keeps it
 * as a pending job for 30 minutes (at most three at once; a new one drops the oldest). Returns
 * the preview (see previewOf), or null when the dialog was cancelled.
 */
export async function previewBackupImport(
  input: PreviewBackupImportInput,
  owner: BrowserWindow | null = null
): Promise<BackupImportPreview | null> {
  const text = "pickFile" in input ? await pickBackupFile(owner) : input.json;
  if (text === null) return null;
  const { document, warnings } = validateBackupDocument(text);
  const now = clock();
  pruneBackupJobs(now);
  for (const oldest of backupJobs.keys()) {
    if (backupJobs.size < MAX_IMPORT_JOBS) break;
    backupJobs.delete(oldest);
  }
  const jobId = nanoid();
  const job = { document, text, warnings, expiresAt: now + IMPORT_JOB_TTL_MS };
  const preview = previewOf(jobId, job);
  backupJobs.set(jobId, job);
  return preview;
}

/**
 * Recomputes a pending job's preview against the library as it is now (revisions, diffs, damage),
 * for a retry after the library changed. Restarts the job's 30 minutes.
 */
export function refreshBackupPreview(jobId: string): BackupImportPreview {
  const now = clock();
  const job = requireBackupJob(jobId, now);
  job.expiresAt = now + IMPORT_JOB_TTL_MS;
  return previewOf(jobId, job);
}

export function cancelBackupImport(jobId: string): void {
  backupJobs.delete(jobId);
}

/**
 * Restores the selected repertoires of a previewed backup (backup-restore.ts `runRestoreJob`: one
 * transaction, with each replaced repertoire's own backup retained first). The restore runs in
 * the restore worker on its own connection, so the main thread only checks the selections and
 * waits; it holds the write gate meanwhile (the IPC handler takes it), so other repertoire writes
 * wait behind it. The job is kept when the restore fails; change events follow the commit.
 */
export async function restoreBackup(input: RestoreBackupInput): Promise<RestoreBackupResult> {
  const now = clock();
  const job = requireBackupJob(input.jobId, now);
  if (!input.selections.length) {
    throw new Error("Invalid selections: choose at least one repertoire to restore");
  }
  if (new Set(input.selections.map((item) => item.sourceId)).size !== input.selections.length) {
    throw new Error("Invalid selections: each repertoire can be restored only once");
  }
  for (const selection of input.selections) {
    if (!job.document.repertoires.some((item) => item.repertoire.id === selection.sourceId)) {
      throw new Error(`Invalid selections: "${selection.sourceId}" is not in this backup`);
    }
  }
  const restored = await runBackupRestore(
    {
      text: job.text,
      selections: input.selections,
      now,
      retainedDirectory: join(app.getPath("userData"), RETAINED_BACKUP_DIR),
      app: backupApp()
    },
    databasePath,
    { requireWorker: app.isPackaged }
  );
  backupJobs.delete(input.jobId);
  for (const item of restored) {
    changed({
      repertoireId: item.repertoireId,
      revision: item.revision,
      kind: item.mode === "replace" ? "updated" : "created"
    });
  }
  return {
    restored: restored.map(({ sourceId, repertoireId, mode, retainedBackupPath }) => ({
      sourceId,
      repertoireId,
      mode,
      retainedBackupPath
    }))
  };
}

/** Forgets previewed backups (tests). */
export function forgetBackupJobs(): void {
  backupJobs.clear();
}
