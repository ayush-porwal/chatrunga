/**
 * Restoring a native backup (design §10), without Electron: validation, the replaced repertoires'
 * retained copies, the restore transaction and the pruning of old retained copies. The service
 * runs it in the backup restore worker (backup-restore-worker.ts) on the worker's own connection,
 * so none of it blocks the main thread; without the bundled worker (tests, development) it runs in
 * the main thread (backup-restore-runner.ts). The service also builds its exports and previews
 * with the backup helpers here.
 */
import { nanoid } from "nanoid";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import {
  REPERTOIRE_POSITION_KEY_VERSION,
  REPERTOIRE_SCHEDULER_VERSION,
  type RepertoireBackupDocument,
  type RepertoireBackupEntry,
  type RepertoireChapter,
  type RestoreBackupResult,
  type RestoreBackupSelection
} from "@chaturanga/shared/types/repertoire";
import {
  buildBackupDocument,
  remapBackupEntry,
  stripForExport,
  validateBackupDocument
} from "@chaturanga/shared/chess/repertoire-backup";
import { MAX_STAGE } from "@chaturanga/shared/chess/repertoire-scheduler";
import {
  cleanName,
  cleanTags,
  cleanText,
  MAX_DESCRIPTION,
  MAX_POLICY_TEXT,
  sanitizeChapter,
  sanitizeHeaders
} from "./chapter-validation";
import { checkRevision, reindex, requireRepertoire, stripFingerprint } from "./core";
import {
  attemptRepository,
  chapterRepository,
  decisionRepository,
  gameLinkRepository,
  libraryGameExists,
  progressRepository,
  repertoireRepository,
  sessionRepository,
  transaction,
  workspaceRepository,
  type RepertoireRecord
} from "./repository";

/** The directory under userData that keeps replaced repertoires' own backups. */
export const RETAINED_BACKUP_DIR = "repertoire-backups";
/** Retained backups kept per repertoire; older ones are deleted after a successful replace. */
const MAX_RETAINED_BACKUPS = 10;
/** The format name of the practice history kept beside a retained backup (never restored). */
const RETAINED_HISTORY_FORMAT = "chaturanga-repertoire-practice-history";

/** The app a backup document names as its writer. */
export type BackupAppInfo = { name: string; version: string };

/** One restore, as the service hands it over (to the worker, or to runRestoreJob in-thread). */
export type RestoreJob = {
  /** The backup text the preview validated; validated again where the restore runs. */
  text: string;
  selections: RestoreBackupSelection[];
  now: number;
  /** Where replaced repertoires' own backups go (`<userData>/repertoire-backups`). */
  retainedDirectory: string;
  app: BackupAppInfo;
};

/** What the restore worker gets through `workerData`. */
export type BackupRestoreData = {
  /** The database file; the worker opens its own connection to it. */
  dbPath: string;
  job: RestoreJob;
};

/** The worker's one reply: what was restored, or why nothing was. */
export type BackupRestoreReply =
  | { ok: true; restored: RestoredRepertoire[] }
  | { ok: false; error: string };

/**
 * The stored state of a repertoire as a backup entry, progress included (callers strip it). A
 * damaged chapter is kept as its raw stored data rather than failing the whole backup. Read inside
 * a transaction so chapters, decisions and progress belong to one revision.
 */
export function backupEntryOf(record: RepertoireRecord): RepertoireBackupEntry {
  return {
    repertoire: {
      id: record.id,
      name: record.name,
      color: record.color,
      description: record.description,
      tags: [...record.tags],
      revision: record.revision,
      archivedAt: record.archivedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    },
    chapters: chapterRepository.listForBackup(record.id),
    decisions: decisionRepository.list(record.id).map(stripFingerprint),
    progress: progressRepository.list(record.id),
    workspace: workspaceRepository.get(record.id),
    gameLinks: gameLinkRepository.list(record.id)
  };
}

/** A backup document of `entries`, written by `app`. */
export function backupDocument(
  entries: RepertoireBackupEntry[],
  now: number,
  app: BackupAppInfo
): RepertoireBackupDocument {
  return buildBackupDocument(entries, {
    app,
    now,
    positionKeyVersion: REPERTOIRE_POSITION_KEY_VERSION,
    schedulerVersion: REPERTOIRE_SCHEDULER_VERSION
  });
}

/** Why restore would refuse this backup text (its reason, without "Invalid backup: "), or null. */
export function restoreRefusal(text: string): string | null {
  try {
    validateBackupDocument(text);
    return null;
  } catch (error) {
    return String(error instanceof Error ? error.message : error).replace(/^Invalid backup: /, "");
  }
}

/**
 * The entry's chapters as they will be stored: every tree replayed from its root (validateTree via
 * sanitizeChapter), metadata pruned. Throws `Invalid backup: chapter "<title>" …` at the first bad
 * chapter, before anything is written.
 */
function restorableChapters(entry: RepertoireBackupEntry): RepertoireChapter[] {
  return entry.chapters.map((chapter) => {
    try {
      return sanitizeChapter(chapter, chapter.revision);
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).replace(
        /^Invalid /,
        ""
      );
      throw new Error(`Invalid backup: chapter "${chapter.title}" can't be restored (${reason})`, {
        cause: error
      });
    }
  });
}

/** Inserts an entry's content under `entry.repertoire.id` (the repertoire row must exist). */
function insertBackupContent(
  entry: RepertoireBackupEntry,
  chapters: readonly RepertoireChapter[],
  includeProgress: boolean,
  keepLinkIds: boolean,
  now: number
): void {
  const repertoireId = entry.repertoire.id;
  for (const chapter of chapters) {
    const owner = chapterRepository.ownerOf(chapter.id);
    if (owner && owner.repertoireId !== repertoireId) {
      throw new Error(
        `Invalid backup: chapter "${chapter.title}" belongs to another repertoire in this library; restore it as a new copy`
      );
    }
    chapterRepository.upsert(repertoireId, chapter, now);
  }
  for (const decision of entry.decisions) {
    const acceptedUcis = [...new Set(decision.acceptedUcis.map((uci) => uci.toLowerCase()))];
    const preferredUci = decision.preferredUci?.toLowerCase() ?? null;
    decisionRepository.upsert(
      {
        repertoireId,
        positionKey: decision.positionKey,
        acceptedUcis,
        preferredUci: preferredUci && acceptedUcis.includes(preferredUci) ? preferredUci : null,
        prompt: cleanText(decision.prompt, MAX_POLICY_TEXT),
        hint: cleanText(decision.hint, MAX_POLICY_TEXT),
        wrongMoveFeedback: Object.fromEntries(
          Object.entries(decision.wrongMoveFeedback)
            .slice(0, 64)
            .map(([uci, text]) => [uci.toLowerCase(), text.slice(0, MAX_POLICY_TEXT)])
        ),
        paused: decision.paused,
        acceptanceFingerprint: ""
      },
      now
    );
  }
  if (includeProgress && entry.progress) {
    for (const progress of entry.progress) {
      progressRepository.upsert({
        ...progress,
        repertoireId,
        stage: Math.min(progress.stage, MAX_STAGE)
      });
    }
  }
  if (entry.workspace) {
    const known = chapters.some((chapter) => chapter.id === entry.workspace!.lastChapterId);
    workspaceRepository.save(
      repertoireId,
      {
        lastChapterId: known ? entry.workspace.lastChapterId : null,
        lastNodeId: known ? entry.workspace.lastNodeId : null,
        orientation: entry.workspace.orientation,
        practiceDraft: null
      },
      now
    );
  }
  for (const link of entry.gameLinks) {
    gameLinkRepository.insert({
      ...link,
      id: keepLinkIds && !gameLinkRepository.get(link.id) ? link.id : nanoid(),
      repertoireId,
      gameId: link.gameId && libraryGameExists(link.gameId) ? link.gameId : null,
      headers: sanitizeHeaders(link.headers),
      capturedPath: link.capturedPath.slice(0, MAX_POLICY_TEXT)
    });
  }
}

/** A file-name-safe form of a repertoire id. */
function safeFileId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "repertoire";
}

/** Syncs a directory entry to disk (best effort: Windows can't open a directory for this). */
function syncDirectory(directory: string): void {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(directory, "r");
    fsyncSync(descriptor);
  } catch {
    // The file itself is already synced; only its directory entry may lag.
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

/** A replaced repertoire's own backup, prepared before anything is written or deleted. */
type RetainedCopy = { record: RepertoireRecord; text: string; history: string };

/**
 * The repertoire's own backup (progress included) as Restore from backup reads it, and its raw
 * practice session and attempt rows as a separate forensic history document (never restored, so
 * it can't make the backup too large to restore). Refused, before anything is deleted, when the
 * backup itself would fail the restore's checks: a replace must leave a copy that can be restored.
 */
function prepareRetainedCopy(
  record: RepertoireRecord,
  now: number,
  app: BackupAppInfo
): RetainedCopy {
  const { entry, history } = transaction(
    () => ({
      entry: stripForExport(backupEntryOf(record), true),
      history: {
        format: RETAINED_HISTORY_FORMAT,
        repertoireId: record.id,
        exportedAt: now,
        sessions: sessionRepository.rawRows(record.id),
        attempts: attemptRepository.rawRowsForRepertoire(record.id)
      }
    }),
    "read"
  );
  const text = JSON.stringify(backupDocument([entry], now, app));
  const refusal = restoreRefusal(text);
  if (refusal) {
    throw new Error(
      `Invalid selections: "${record.name}" can't be replaced because its own backup couldn't be restored (${refusal}); restore the backup as a new copy`
    );
  }
  return { record, text, history: JSON.stringify(history) };
}

/** The forensic history file kept beside a retained backup. */
function historyPathOf(backupPath: string): string {
  return backupPath.replace(/\.json$/, ".history.json");
}

/**
 * Writes a prepared copy to `directory` (`<userData>/repertoire-backups/`) and returns the backup's path; its
 * history goes beside it (`<name>.history.json`). The backup is created exclusively (a random
 * suffix on a name collision), then both files and their directory are synced, so they are on
 * disk before the replace deletes anything.
 */
function retainBackup(
  { record, text, history }: RetainedCopy,
  now: number,
  directory: string
): string {
  mkdirSync(directory, { recursive: true });
  const base = `${safeFileId(record.id)}-${new Date(now).toISOString().replace(/[:.]/g, "-")}`;
  let path = join(directory, `${base}.json`);
  let descriptor: number | null = null;
  for (let attempt = 0; descriptor === null; attempt += 1) {
    try {
      descriptor = openSync(path, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt >= 5) throw error;
      path = join(directory, `${base}-${nanoid(8)}.json`);
    }
  }
  try {
    writeFileSync(descriptor, text, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  const historyDescriptor = openSync(historyPathOf(path), "w");
  try {
    writeFileSync(historyDescriptor, history, "utf8");
    fsyncSync(historyDescriptor);
  } finally {
    closeSync(historyDescriptor);
  }
  syncDirectory(directory);
  return path;
}

const RETAINED_NAME =
  /^(.+)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)(?:-[A-Za-z0-9_-]+)?\.json$/;

/**
 * Deletes all but the newest MAX_RETAINED_BACKUPS retained backups of a repertoire (best effort:
 * a file that can't be listed or deleted is left).
 */
function pruneRetainedBackups(directory: string, repertoireId: string): void {
  const fileId = safeFileId(repertoireId);
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return;
  }
  const retained = names
    .map((name) => ({ name, match: RETAINED_NAME.exec(name) }))
    .filter((item) => item.match?.[1] === fileId)
    .sort((a, b) => {
      const stamp = b.match![2].localeCompare(a.match![2]);
      return stamp || b.name.localeCompare(a.name);
    });
  for (const { name } of retained.slice(MAX_RETAINED_BACKUPS)) {
    try {
      unlinkSync(join(directory, name));
      rmSync(historyPathOf(join(directory, name)), { force: true });
    } catch {
      // Left for the next replace to try again.
    }
  }
}

export type RestoredRepertoire = RestoreBackupResult["restored"][number] & { revision: number };

function restoreNewCopy(
  entry: RepertoireBackupEntry,
  chapters: readonly RepertoireChapter[],
  selection: RestoreBackupSelection,
  now: number
): RestoredRepertoire {
  const chapterIds = new Map(chapters.map((chapter) => [chapter.id, nanoid()]));
  const copy = remapBackupEntry(entry, {
    newRepertoireId: nanoid(),
    idFor: (chapterId) => chapterIds.get(chapterId) ?? nanoid(),
    linkIdFor: () => nanoid()
  });
  const name = selection.newName?.trim()
    ? cleanName(selection.newName)
    : cleanName(`${entry.repertoire.name || "Repertoire"} (restored)`);
  repertoireRepository.insert({
    id: copy.repertoire.id,
    name,
    color: copy.repertoire.color,
    description: cleanText(copy.repertoire.description, MAX_DESCRIPTION) ?? "",
    tags: cleanTags(copy.repertoire.tags),
    revision: 1,
    archivedAt: null,
    createdAt: now,
    updatedAt: now
  });
  const copiedChapters = chapters.map((chapter) => ({
    ...chapter,
    id: chapterIds.get(chapter.id)!,
    revision: 1
  }));
  insertBackupContent(copy, copiedChapters, selection.includeProgress, false, now);
  reindex(requireRepertoire(copy.repertoire.id), now);
  return {
    sourceId: entry.repertoire.id,
    repertoireId: copy.repertoire.id,
    mode: "new-copy",
    retainedBackupPath: null,
    revision: 1
  };
}

/**
 * The repertoire a replace overwrites, after the checks that refuse it: it must exist, be at the
 * revision the user saw, have the backup's color, and have no practice session in progress.
 */
function checkReplace(
  entry: RepertoireBackupEntry,
  selection: RestoreBackupSelection
): RepertoireRecord {
  const existing = repertoireRepository.get(entry.repertoire.id);
  if (!existing) {
    throw new Error(
      `Invalid selections: "${entry.repertoire.name}" has no repertoire in this library to replace; restore it as a new copy`
    );
  }
  if (selection.expectedRevision === undefined) {
    throw new Error("Invalid expectedRevision: required to replace a repertoire");
  }
  checkRevision(existing, selection.expectedRevision);
  if (existing.color !== entry.repertoire.color) {
    throw new Error(
      `Invalid backup: "${existing.name}" is a ${existing.color} repertoire in this library; restore it as a new copy`
    );
  }
  if (sessionRepository.count(existing.id, "active") > 0) {
    throw new Error(
      `Invalid selections: "${existing.name}" has a practice session in progress; end it first`
    );
  }
  return existing;
}

function restoreReplace(
  entry: RepertoireBackupEntry,
  chapters: readonly RepertoireChapter[],
  selection: RestoreBackupSelection,
  retainedBackupPath: string,
  now: number
): RestoredRepertoire {
  const existing = checkReplace(entry, selection);
  // Deleting the row cascades to chapters, decisions, index, progress, sessions, workspace, links.
  repertoireRepository.remove(existing.id);
  const revision = Math.max(existing.revision, entry.repertoire.revision) + 1;
  repertoireRepository.insert({
    id: existing.id,
    name: cleanName(entry.repertoire.name || existing.name),
    color: entry.repertoire.color,
    description: cleanText(entry.repertoire.description, MAX_DESCRIPTION) ?? "",
    tags: cleanTags(entry.repertoire.tags),
    revision,
    archivedAt: entry.repertoire.archivedAt,
    createdAt: entry.repertoire.createdAt,
    updatedAt: now
  });
  insertBackupContent(entry, chapters, selection.includeProgress, true, now);
  reindex(requireRepertoire(existing.id), now);
  return {
    sourceId: entry.repertoire.id,
    repertoireId: existing.id,
    mode: "replace",
    retainedBackupPath,
    revision
  };
}

/**
 * Restores the selected repertoires of a backup in one transaction, so a failure leaves nothing
 * half-restored. `new-copy` inserts the content under fresh ids at revision 1. `replace` is
 * refused unless checkReplace passes; before the transaction begins, the existing repertoire's own
 * backup (with its practice history) is written and synced to the retained directory, then its
 * content, progress and practice sessions are swapped for the backup's under the same id at a
 * revision above both. Afterwards only the newest ten retained backups of each replaced
 * repertoire are kept. Progress is restored only with `includeProgress`. A link keeps its game
 * only if this library has it. The index and effective decisions are rebuilt (decisions nothing
 * reaches are suspended).
 */
export function runRestoreJob(job: RestoreJob): RestoredRepertoire[] {
  const { now, selections } = job;
  const { document } = validateBackupDocument(job.text);
  const planned = selections.map((selection) => {
    const entry = document.repertoires.find((item) => item.repertoire.id === selection.sourceId);
    if (!entry) {
      throw new Error(`Invalid selections: "${selection.sourceId}" is not in this backup`);
    }
    return { selection, entry, chapters: restorableChapters(entry) };
  });
  // Every replace is checked, and its own backup prepared (and checked restorable), before any
  // backup is retained; all are retained before BEGIN.
  const copies = planned
    .filter(({ selection }) => selection.mode === "replace")
    .map(({ selection, entry }) =>
      prepareRetainedCopy(checkReplace(entry, selection), now, job.app)
    );
  const retained = new Map<string, string>();
  for (const copy of copies) {
    retained.set(copy.record.id, retainBackup(copy, now, job.retainedDirectory));
  }
  const restored = transaction(() =>
    planned.map(({ selection, entry, chapters }) =>
      selection.mode === "replace"
        ? restoreReplace(entry, chapters, selection, retained.get(entry.repertoire.id)!, now)
        : restoreNewCopy(entry, chapters, selection, now)
    )
  );
  for (const item of restored) {
    if (item.mode === "replace") pruneRetainedBackups(job.retainedDirectory, item.repertoireId);
  }
  return restored;
}
