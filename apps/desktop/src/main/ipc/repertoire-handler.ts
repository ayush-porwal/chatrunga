import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import { IMPORT_CANCELLED_REPLY } from "@chaturanga/shared/types/repertoire";
import { ImportCancelledError } from "../repertoire/import-job";
import { logger } from "../logger";
import { asId } from "./fields";
import {
  parseAddFromGameInput,
  parseArchiveRepertoireInput,
  parseChapterRef,
  parseCompareGameInput,
  parseDecisionRef,
  parsePractisedElsewhereInput,
  parseCreateRepertoireInput,
  parseDuplicateRepertoireInput,
  parseExportBackupInput,
  parseExportInput,
  parseGameLinkQuery,
  parseImportCommitInput,
  parseLinkGameInput,
  parsePracticeActionInput,
  parsePreviewBackupImportInput,
  parsePreviewImportInput,
  parseRecordAttemptInput,
  parseRemoveChapterInput,
  parseUpdateChaptersInput,
  parseRemoveGameLink,
  parseRemoveRepertoireInput,
  parseRepertoireListFilters,
  parseRestoreBackupInput,
  parseSaveChapterInput,
  parseSaveWorkspaceInput,
  parseStartPracticeInput,
  parseUpdateDecisionInput,
  parseUpdateRepertoireMetadataInput,
  parseOpeningOfInput
} from "./validate-repertoire";

/**
 * Deletes, in the background, the page images of books whose rows went with their repertoire (a
 * removal, or a backup restore replacing it); run after the write committed.
 */
function sweepBookPages(): void {
  import("../books")
    .then((books) => books.sweepBookFiles())
    .catch((error: unknown) => logger.error("books", "sweeping book pages failed:", error));
}

/** The repertoire service (main/repertoire/service.ts), loaded with the first request. */
const service = () => import("../repertoire/service");
type RepertoireService = Awaited<ReturnType<typeof service>>;

/**
 * A handler that parses its input at once (a malformed one throws before the service loads), then
 * calls the service with it.
 */
function read<T>(
  parse: (value: unknown) => T,
  call: (repertoires: RepertoireService, input: T) => unknown
) {
  return (_event: IpcMainInvokeEvent, value: unknown) => {
    const input = parse(value);
    return service().then((repertoires) => call(repertoires, input));
  };
}

/** As `read`, the call inside the service's write gate. */
function write<T>(
  parse: (value: unknown) => T,
  call: (repertoires: RepertoireService, input: T) => unknown
) {
  return read(parse, (repertoires, input) =>
    repertoires.withRepertoireWriteGate(() => call(repertoires, input))
  );
}

/** Inputs that are only an id. */
const repertoireId = (value: unknown) => asId(value, "repertoireId");
const jobId = (value: unknown) => asId(value, "jobId");
const sessionId = (value: unknown) => asId(value, "sessionId");
const none = () => undefined;

/**
 * Repertoires (main/repertoire/service.ts): every input is parsed before the service sees it (and
 * before it loads). Every write passes the service's write gate (`withRepertoireWriteGate`;
 * `commitImport` takes it itself), so it waits for a running import commit without blocking the
 * main process.
 */
export function registerRepertoireIpc(): void {
  ipcMain.handle(
    "repertoires:list",
    read(parseRepertoireListFilters, (repertoires, filters) => repertoires.listRepertoires(filters))
  );
  ipcMain.handle(
    "repertoires:get",
    read(repertoireId, (repertoires, id) => repertoires.getRepertoire(id))
  );
  ipcMain.handle(
    "repertoires:getChapter",
    read(parseChapterRef, (repertoires, ref) => repertoires.getChapter(ref))
  );
  ipcMain.handle(
    "repertoires:getDecision",
    read(parseDecisionRef, (repertoires, ref) => repertoires.getDecision(ref))
  );
  ipcMain.handle(
    "repertoires:getPractisedElsewhere",
    read(parsePractisedElsewhereInput, (repertoires, input) =>
      repertoires.getPractisedElsewhere(input)
    )
  );
  ipcMain.handle(
    "repertoires:getPausedKeys",
    read(repertoireId, (repertoires, id) => repertoires.getPausedKeys(id))
  );
  ipcMain.handle(
    "repertoires:getOccurrences",
    read(parseDecisionRef, (repertoires, ref) => repertoires.getOccurrences(ref))
  );
  ipcMain.handle(
    "repertoires:compareGame",
    read(parseCompareGameInput, (repertoires, input) => repertoires.compareGame(input))
  );
  ipcMain.handle(
    "repertoires:previewAddFromGame",
    read(parseAddFromGameInput, (repertoires, input) => repertoires.previewAddFromGame(input))
  );
  ipcMain.handle(
    "repertoires:addFromGame",
    write(parseAddFromGameInput, (repertoires, input) => repertoires.addFromGame(input))
  );
  ipcMain.handle(
    "repertoires:listGameLinks",
    read(parseGameLinkQuery, (repertoires, query) => repertoires.listGameLinks(query))
  );
  ipcMain.handle(
    "repertoires:removeGameLink",
    write(parseRemoveGameLink, (repertoires, input) => repertoires.removeGameLink(input))
  );
  ipcMain.handle(
    "repertoires:linkGame",
    write(parseLinkGameInput, (repertoires, input) => repertoires.linkGame(input))
  );
  ipcMain.handle(
    "repertoires:create",
    write(parseCreateRepertoireInput, (repertoires, input) => repertoires.createRepertoire(input))
  );
  ipcMain.handle(
    "repertoires:updateMetadata",
    write(parseUpdateRepertoireMetadataInput, (repertoires, input) =>
      repertoires.updateMetadata(input)
    )
  );
  ipcMain.handle(
    "repertoires:saveChapter",
    write(parseSaveChapterInput, (repertoires, input) => repertoires.saveChapter(input))
  );
  ipcMain.handle(
    "repertoires:updateDecision",
    write(parseUpdateDecisionInput, (repertoires, input) => repertoires.updateDecision(input))
  );
  ipcMain.handle(
    "repertoires:removeChapter",
    write(parseRemoveChapterInput, (repertoires, input) => repertoires.removeChapter(input))
  );
  ipcMain.handle(
    "repertoires:updateChapters",
    write(parseUpdateChaptersInput, (repertoires, input) => repertoires.updateChapters(input))
  );
  ipcMain.handle(
    "repertoires:duplicate",
    write(parseDuplicateRepertoireInput, (repertoires, input) =>
      repertoires.duplicateRepertoire(input)
    )
  );
  ipcMain.handle(
    "repertoires:archive",
    write(parseArchiveRepertoireInput, (repertoires, input) => repertoires.archiveRepertoire(input))
  );
  ipcMain.handle("repertoires:remove", async (_event, value: unknown) => {
    const input = parseRemoveRepertoireInput(value);
    const repertoires = await service();
    const removed = await repertoires.withRepertoireWriteGate(() =>
      repertoires.removeRepertoire(input)
    );
    sweepBookPages();
    return removed;
  });
  // A cancelled preview resolves with a marker the preload turns back into the rejection, so a
  // cancel (an expected outcome) isn't logged as a failed handler.
  ipcMain.handle(
    "repertoires:previewImport",
    read(parsePreviewImportInput, (repertoires, input) =>
      Promise.resolve(repertoires.previewImport(input)).catch((error: unknown) => {
        if (error instanceof ImportCancelledError) return IMPORT_CANCELLED_REPLY;
        throw error;
      })
    )
  );
  ipcMain.handle(
    "repertoires:commitImport",
    read(parseImportCommitInput, (repertoires, input) => repertoires.commitImport(input))
  );
  ipcMain.handle(
    "repertoires:cancelImport",
    read(jobId, (repertoires, id) => repertoires.cancelImport(id))
  );
  // The save dialog is parented to the calling window; the renderer never names a destination.
  ipcMain.handle("repertoires:export", (event, value: unknown) => {
    const input = parseExportInput(value);
    const window = BrowserWindow.fromWebContents(event.sender);
    return service().then((repertoires) => repertoires.exportRepertoire(input, window));
  });
  // Native backups: the save/open dialogs are parented to the calling window; no renderer path.
  ipcMain.handle("repertoires:exportBackup", (event, value: unknown) => {
    const input = parseExportBackupInput(value);
    const window = BrowserWindow.fromWebContents(event.sender);
    return service().then((repertoires) => repertoires.exportBackup(input, window));
  });
  ipcMain.handle("repertoires:previewBackupImport", (event, value: unknown) => {
    const input = parsePreviewBackupImportInput(value);
    const window = BrowserWindow.fromWebContents(event.sender);
    return service().then((repertoires) => repertoires.previewBackupImport(input, window));
  });
  ipcMain.handle("repertoires:restoreBackup", async (_event, value: unknown) => {
    const input = parseRestoreBackupInput(value);
    const repertoires = await service();
    const restored = await repertoires.withRepertoireWriteGate(() =>
      repertoires.restoreBackup(input)
    );
    // A replaced repertoire is deleted and inserted again: a book of it went with the delete.
    if (input.selections.some((selection) => selection.mode === "replace")) sweepBookPages();
    return restored;
  });
  ipcMain.handle(
    "repertoires:refreshBackupPreview",
    read(jobId, (repertoires, id) => repertoires.refreshBackupPreview(id))
  );
  ipcMain.handle(
    "repertoires:cancelBackupImport",
    read(jobId, (repertoires, id) => repertoires.cancelBackupImport(id))
  );
  ipcMain.handle(
    "repertoires:startPractice",
    write(parseStartPracticeInput, (repertoires, input) => repertoires.startPractice(input))
  );
  ipcMain.handle(
    "repertoires:resumePractice",
    write(sessionId, (repertoires, id) => repertoires.resumePractice(id))
  );
  ipcMain.handle(
    "repertoires:recordPracticeAction",
    write(parsePracticeActionInput, (repertoires, input) => repertoires.recordPracticeAction(input))
  );
  ipcMain.handle(
    "repertoires:recordAttempt",
    write(parseRecordAttemptInput, (repertoires, input) => repertoires.recordAttempt(input))
  );
  ipcMain.handle(
    "repertoires:endPractice",
    write(sessionId, (repertoires, id) => repertoires.endPractice(id))
  );
  ipcMain.handle(
    "repertoires:saveWorkspace",
    write(parseSaveWorkspaceInput, (repertoires, input) => repertoires.saveWorkspace(input))
  );
  ipcMain.handle(
    "repertoires:getDueSummary",
    read(none, (repertoires) => repertoires.getDueSummary())
  );
  registerPracticeHomeIpc();
}

/** Seconds after startup the background opening detection waits (the window loads first). */
const OPENING_DETECTION_DELAY_MS = 10_000;

/**
 * The practice home (docs/repertoire-games-and-practice.md §2, §4): openings, and the Practice
 * tab's numbers. Chapters stored before openings were detected get theirs once, in the background.
 */
function registerPracticeHomeIpc(): void {
  ipcMain.handle(
    "repertoires:openingOf",
    read(parseOpeningOfInput, (repertoires, input) => repertoires.openingOfLine(input))
  );
  ipcMain.handle(
    "repertoires:bookOpenings",
    read(none, (repertoires) => repertoires.bookOpenings())
  );
  ipcMain.handle(
    "repertoires:practiceOverview",
    read(none, (repertoires) => repertoires.practiceOverview())
  );
  setTimeout(() => {
    service()
      .then((repertoires) => repertoires.detectMissingOpenings())
      .catch((error: unknown) =>
        logger.error("repertoire", "detecting chapter openings failed:", error)
      );
  }, OPENING_DETECTION_DELAY_MS).unref();
}
