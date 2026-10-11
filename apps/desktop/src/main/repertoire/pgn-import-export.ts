/** PGN import (preview in the import worker, commit in the writer worker) and PGN export. */
import { app, BrowserWindow, dialog } from "electron";
import { nanoid } from "nanoid";
import { writeFile } from "node:fs/promises";
import {
  type ExportInput,
  type ExportResult,
  type ImportCommitInput,
  type ImportPreview,
  type ImportProgressEvent,
  type ImportResult,
  type PreviewImportInput
} from "@chaturanga/shared/types/repertoire";
import { exportRepertoirePgn } from "@chaturanga/shared/chess/repertoire-pgn";
import { databasePath } from "../db";
import { broadcast } from "../ipc/broadcast";
import {
  DEFAULT_IMPORT_LIMITS,
  ImportCancelledError,
  type ImportedGame,
  type ImportLimits,
  type ImportProgress
} from "./import-job";
import { startImportParse, type ImportRun } from "./import-runner";
import { runImportCommit } from "./import-writer";
import { checkRevision, requireRepertoire, type ImportCommitChapter } from "./core";
import { chapterRepository, transaction } from "./repository";
import {
  IMPORT_JOB_TTL_MS,
  MAX_IMPORT_JOBS,
  changed,
  clock,
  withRepertoireWriteGate
} from "./service-runtime";

const MAX_PGN_BYTES = 20 * 1024 * 1024;

type ImportJob = { games: ImportedGame[]; expiresAt: number };
/** Previewed imports waiting for a commit, oldest first. */
const importJobs = new Map<string, ImportJob>();
/** Imports still being parsed (in the import worker), oldest first. */
const runningImports = new Map<string, ImportRun>();
/** The limits previews enforce (replaced in tests). */
let importLimits: ImportLimits = DEFAULT_IMPORT_LIMITS;

/** Replaces the import limits (tests only); pass nothing to restore the defaults. */
export function setImportLimits(next?: Partial<ImportLimits>): void {
  importLimits = { ...DEFAULT_IMPORT_LIMITS, ...next };
}

function pruneImportJobs(now: number): void {
  for (const [jobId, job] of importJobs) if (job.expiresAt <= now) importJobs.delete(jobId);
}

/**
 * Keeps room for one more job: running and previewed jobs together stay under MAX_IMPORT_JOBS.
 * The oldest previewed jobs are dropped first; a running parse is never cancelled for room, so
 * with only running parses left the new preview is refused.
 */
function makeRoomForImport(): void {
  while (importJobs.size + runningImports.size >= MAX_IMPORT_JOBS) {
    const pending = importJobs.keys().next().value;
    if (pending === undefined) {
      throw new Error("Another import is still parsing; wait or cancel it.");
    }
    importJobs.delete(pending);
  }
}

function importProgress(
  jobId: string,
  phase: ImportProgressEvent["phase"],
  progress: Omit<ImportProgress, "phase">,
  error: string | null = null
): void {
  const event: ImportProgressEvent = {
    jobId,
    phase,
    bytesRead: progress.bytesRead,
    totalBytes: progress.totalBytes,
    gamesSeen: progress.gamesSeen,
    nodesSeen: progress.nodesSeen,
    error
  };
  broadcast("repertoires:importProgress", event);
}

/**
 * Parses every game of a PGN text (pasted, or read through the native file picker) in the import
 * worker, into a pending job that expires after 30 minutes. The job id is the caller's `jobId`
 * (generated when omitted); it is registered before this returns its promise, so `cancelImport`
 * works at once, even before the first progress event. Progress goes out as
 * `repertoires:importProgress` events ending with `ready`, `failed` or `cancelled`. Bounded by
 * the import limits (20 MiB, games, moves, depth); the first limit crossed rejects with its
 * actionable message, while a comment over its limit only rejects its game. Running and pending jobs together stay under MAX_IMPORT_JOBS: a
 * new preview drops the oldest pending job, and is refused while only running parses fill them.
 */
export async function previewImport(input: PreviewImportInput): Promise<ImportPreview> {
  const text = input.pgn;
  if (typeof text !== "string" || text.length > MAX_PGN_BYTES) {
    throw new Error("Invalid PGN: expected text up to 20 MiB");
  }
  const jobId = input.jobId ?? nanoid();
  if (runningImports.has(jobId) || importJobs.has(jobId)) {
    throw new Error("Invalid jobId: already in use");
  }
  pruneImportJobs(clock());
  makeRoomForImport();
  let last: Omit<ImportProgress, "phase"> = {
    bytesRead: 0,
    totalBytes: null,
    gamesSeen: 0,
    nodesSeen: 0
  };
  const run = startImportParse(
    { jobId, source: { kind: "text", text }, limits: importLimits },
    (progress) => {
      last = progress;
      importProgress(jobId, progress.phase, progress);
    },
    { requireWorker: app.isPackaged }
  );
  runningImports.set(jobId, run);
  let games: ImportedGame[];
  try {
    games = (await run.result).games;
  } catch (error) {
    if (error instanceof ImportCancelledError) {
      importProgress(jobId, "cancelled", last);
    } else {
      importProgress(jobId, "failed", last, error instanceof Error ? error.message : String(error));
    }
    throw error;
  } finally {
    if (runningImports.get(jobId) === run) runningImports.delete(jobId);
  }
  const now = clock();
  pruneImportJobs(now);
  importJobs.set(jobId, { games, expiresAt: now + IMPORT_JOB_TTL_MS });
  importProgress(jobId, "ready", {
    ...last,
    bytesRead: last.totalBytes ?? last.bytesRead,
    gamesSeen: games.length,
    nodesSeen: games.reduce((sum, game) => sum + game.nodeCount, 0)
  });
  return {
    jobId,
    games: games.map((game) => ({
      index: game.index,
      proposedTitle: game.proposedTitle,
      rootFen: game.rootFen,
      headers: game.headers,
      nodeCount: game.nodeCount,
      // Only a game with illegal branches offers lines to exclude; the others send no tree.
      tree: game.invalidBranches.length ? game.tree : [],
      decisions: game.decisions,
      warnings: game.warnings,
      invalidBranches: game.invalidBranches
    }))
  };
}

/**
 * Commits the selected games of a previewed job as new chapters, atomically, in the import writer
 * worker on its own connection (core.ts `commitImportJob`). It holds the write gate until the
 * worker replies, so other repertoire writes wait behind it; `repertoires:changed` goes out only
 * after the commit is stored. The selections are checked here first; a failed commit writes
 * nothing and keeps the job.
 */
export function commitImport(input: ImportCommitInput): Promise<ImportResult> {
  return withRepertoireWriteGate(() => storeImport(input));
}

async function storeImport(input: ImportCommitInput): Promise<ImportResult> {
  const now = clock();
  pruneImportJobs(now);
  const job = importJobs.get(input.jobId);
  if (!job)
    throw new Error("Invalid jobId: the import expired or was cancelled; preview the PGN again");
  // Checked again inside the writer's transaction.
  checkRevision(requireRepertoire(input.repertoireId), input.expectedRevision);
  const selections = input.selections.filter((selection) => selection.include);
  if (!selections.length) throw new Error("Invalid selections: choose at least one game to import");
  if (new Set(selections.map((selection) => selection.gameIndex)).size !== selections.length) {
    throw new Error("Invalid selections: each game can be included only once");
  }
  const gamesByIndex = new Map(job.games.map((game) => [game.index, game]));
  const chapters: ImportCommitChapter[] = selections.map((selection) => {
    const game = gamesByIndex.get(selection.gameIndex);
    if (!game)
      throw new Error(`Invalid selections: game ${selection.gameIndex} is not in this import`);
    if (game.rejected) {
      throw new Error(
        `Invalid selections: game ${selection.gameIndex + 1} can't be imported (${game.rejected})`
      );
    }
    return {
      title: selection.title,
      proposedTitle: game.proposedTitle,
      kind: selection.kind,
      rootFen: game.rootFen,
      headers: game.headers,
      tree: game.tree,
      excludeNodeIds: selection.excludeNodeIds ?? [],
      positionKeys: game.positionKeys
    };
  });
  const result = await runImportCommit(
    {
      repertoireId: input.repertoireId,
      expectedRevision: input.expectedRevision,
      now,
      maxNodes: importLimits.maxNodes,
      chapters
    },
    databasePath,
    { requireWorker: app.isPackaged }
  );
  importJobs.delete(input.jobId);
  changed({
    repertoireId: input.repertoireId,
    revision: result.repertoire.revision,
    kind: "updated"
  });
  return result;
}

/**
 * Cancels an import: a running parse stops (its preview rejects with "The import was cancelled."
 * and a `cancelled` progress event follows), and a previewed job is forgotten. Nothing was written
 * either way; an unknown job id is ignored.
 */
export function cancelImport(jobId: string): void {
  const running = runningImports.get(jobId);
  if (running) {
    runningImports.delete(jobId);
    running.cancel();
  }
  importJobs.delete(jobId);
}

/** A bare file name (no directories) for the save dialog. */
function exportFileName(name: string): string {
  const base = name.replace(/[\\/:*?"<>|]/g, "_").trim() || "repertoire";
  return `${base}.pgn`;
}

/**
 * Multi-game PGN of a consistent snapshot (one read transaction), offered through a native save
 * dialog. The destination is only ever the path the user picked in that dialog.
 */
export async function exportRepertoire(
  input: ExportInput,
  owner: BrowserWindow | null = null
): Promise<ExportResult> {
  const { record, chapters } = transaction(() => {
    const record = requireRepertoire(input.repertoireId);
    let chapters = chapterRepository.list(record.id);
    if (input.chapterIds) {
      const known = new Set(chapters.map((chapter) => chapter.id));
      const missing = input.chapterIds.find((id) => !known.has(id));
      if (missing) throw new Error(`Invalid chapterIds: "${missing}" is not in this repertoire`);
      const wanted = new Set(input.chapterIds);
      chapters = chapters.filter((chapter) => wanted.has(chapter.id));
    }
    return { record, chapters };
  }, "read");
  if (!chapters.length) throw new Error("Invalid export: there are no chapters to export");
  const pgn = exportRepertoirePgn(
    chapters.map((chapter) => ({
      title: chapter.title,
      headers: chapter.headers,
      rootFen: chapter.rootFen,
      tree: chapter.tree
    }))
  );
  const window = owner ?? BrowserWindow.getFocusedWindow();
  const options = {
    defaultPath: exportFileName(record.name),
    filters: [{ name: "PGN files", extensions: ["pgn"] }]
  };
  const choice = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options);
  let savedPath: string | null = null;
  if (!choice.canceled && choice.filePath) {
    await writeFile(choice.filePath, pgn, "utf8");
    savedPath = choice.filePath;
  }
  return { pgn, chapterCount: chapters.length, savedPath };
}

/** Forgets pending imports, cancelling running parses (tests). */
export function forgetImportJobs(): void {
  for (const jobId of [...runningImports.keys()]) cancelImport(jobId);
  importJobs.clear();
}
