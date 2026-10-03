import { BrowserWindow, ipcMain } from "electron";
import {
  addFromGame,
  archiveRepertoire,
  cancelBackupImport,
  cancelImport,
  commitImport,
  compareGame,
  createRepertoire,
  duplicateRepertoire,
  endPractice,
  exportBackup,
  exportRepertoire,
  getChapter,
  getDecision,
  getPausedKeys,
  getPractisedElsewhere,
  getOccurrences,
  getDueSummary,
  getRepertoire,
  linkGame,
  listGameLinks,
  listRepertoires,
  previewAddFromGame,
  previewBackupImport,
  previewImport,
  recordAttempt,
  recordPracticeAction,
  refreshBackupPreview,
  removeChapter,
  updateChapters,
  removeGameLink,
  removeRepertoire,
  restoreBackup,
  resumePractice,
  saveChapter,
  saveWorkspace,
  startPractice,
  updateDecision,
  updateMetadata,
  withRepertoireWriteGate
} from "../repertoire/service";
import { IMPORT_CANCELLED_REPLY } from "@chaturanga/shared/types/repertoire";
import { ImportCancelledError } from "../repertoire/import-job";
import {
  asId,
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
  parseUpdateRepertoireMetadataInput
} from "./validate";

/**
 * Repertoires (main/repertoire/service.ts): every input is parsed before the service sees it.
 * Every write passes the service's write gate (`withRepertoireWriteGate`; `commitImport` takes it
 * itself), so it waits for a running import commit without blocking the main process.
 */
export function registerRepertoireIpc(): void {
  ipcMain.handle("repertoires:list", (_event, filters: unknown) =>
    listRepertoires(parseRepertoireListFilters(filters))
  );
  ipcMain.handle("repertoires:get", (_event, id: unknown) =>
    getRepertoire(asId(id, "repertoireId"))
  );
  ipcMain.handle("repertoires:getChapter", (_event, input: unknown) =>
    getChapter(parseChapterRef(input))
  );
  ipcMain.handle("repertoires:getDecision", (_event, input: unknown) =>
    getDecision(parseDecisionRef(input))
  );
  ipcMain.handle("repertoires:getPractisedElsewhere", (_event, input: unknown) =>
    getPractisedElsewhere(parsePractisedElsewhereInput(input))
  );
  ipcMain.handle("repertoires:getPausedKeys", (_event, id: unknown) =>
    getPausedKeys(asId(id, "repertoireId"))
  );
  ipcMain.handle("repertoires:getOccurrences", (_event, input: unknown) =>
    getOccurrences(parseDecisionRef(input))
  );
  ipcMain.handle("repertoires:compareGame", (_event, input: unknown) =>
    compareGame(parseCompareGameInput(input))
  );
  ipcMain.handle("repertoires:previewAddFromGame", (_event, input: unknown) =>
    previewAddFromGame(parseAddFromGameInput(input))
  );
  ipcMain.handle("repertoires:addFromGame", (_event, input: unknown) => {
    const parsed = parseAddFromGameInput(input);
    return withRepertoireWriteGate(() => addFromGame(parsed));
  });
  ipcMain.handle("repertoires:listGameLinks", (_event, input: unknown) =>
    listGameLinks(parseGameLinkQuery(input))
  );
  ipcMain.handle("repertoires:removeGameLink", (_event, input: unknown) => {
    const parsed = parseRemoveGameLink(input);
    return withRepertoireWriteGate(() => removeGameLink(parsed));
  });
  ipcMain.handle("repertoires:linkGame", (_event, input: unknown) => {
    const parsed = parseLinkGameInput(input);
    return withRepertoireWriteGate(() => linkGame(parsed));
  });
  ipcMain.handle("repertoires:create", (_event, input: unknown) => {
    const parsed = parseCreateRepertoireInput(input);
    return withRepertoireWriteGate(() => createRepertoire(parsed));
  });
  ipcMain.handle("repertoires:updateMetadata", (_event, input: unknown) => {
    const parsed = parseUpdateRepertoireMetadataInput(input);
    return withRepertoireWriteGate(() => updateMetadata(parsed));
  });
  ipcMain.handle("repertoires:saveChapter", (_event, input: unknown) => {
    const parsed = parseSaveChapterInput(input);
    return withRepertoireWriteGate(() => saveChapter(parsed));
  });
  ipcMain.handle("repertoires:updateDecision", (_event, input: unknown) => {
    const parsed = parseUpdateDecisionInput(input);
    return withRepertoireWriteGate(() => updateDecision(parsed));
  });
  ipcMain.handle("repertoires:removeChapter", (_event, input: unknown) => {
    const parsed = parseRemoveChapterInput(input);
    return withRepertoireWriteGate(() => removeChapter(parsed));
  });
  ipcMain.handle("repertoires:updateChapters", (_event, input: unknown) => {
    const parsed = parseUpdateChaptersInput(input);
    return withRepertoireWriteGate(() => updateChapters(parsed));
  });
  ipcMain.handle("repertoires:duplicate", (_event, input: unknown) => {
    const parsed = parseDuplicateRepertoireInput(input);
    return withRepertoireWriteGate(() => duplicateRepertoire(parsed));
  });
  ipcMain.handle("repertoires:archive", (_event, input: unknown) => {
    const parsed = parseArchiveRepertoireInput(input);
    return withRepertoireWriteGate(() => archiveRepertoire(parsed));
  });
  ipcMain.handle("repertoires:remove", (_event, input: unknown) => {
    const parsed = parseRemoveRepertoireInput(input);
    return withRepertoireWriteGate(() => removeRepertoire(parsed));
  });
  // A cancelled preview resolves with a marker the preload turns back into the rejection, so a
  // cancel (an expected outcome) isn't logged as a failed handler.
  ipcMain.handle("repertoires:previewImport", (_event, input: unknown) =>
    Promise.resolve(previewImport(parsePreviewImportInput(input))).catch((error: unknown) => {
      if (error instanceof ImportCancelledError) return IMPORT_CANCELLED_REPLY;
      throw error;
    })
  );
  ipcMain.handle("repertoires:commitImport", (_event, input: unknown) =>
    commitImport(parseImportCommitInput(input))
  );
  ipcMain.handle("repertoires:cancelImport", (_event, jobId: unknown) =>
    cancelImport(asId(jobId, "jobId"))
  );
  // The save dialog is parented to the calling window; the renderer never names a destination.
  ipcMain.handle("repertoires:export", (event, input: unknown) =>
    exportRepertoire(parseExportInput(input), BrowserWindow.fromWebContents(event.sender))
  );
  // Native backups: the save/open dialogs are parented to the calling window; no renderer path.
  ipcMain.handle("repertoires:exportBackup", (event, input: unknown) =>
    exportBackup(parseExportBackupInput(input), BrowserWindow.fromWebContents(event.sender))
  );
  ipcMain.handle("repertoires:previewBackupImport", (event, input: unknown) =>
    previewBackupImport(
      parsePreviewBackupImportInput(input),
      BrowserWindow.fromWebContents(event.sender)
    )
  );
  ipcMain.handle("repertoires:restoreBackup", (_event, input: unknown) => {
    const parsed = parseRestoreBackupInput(input);
    return withRepertoireWriteGate(() => restoreBackup(parsed));
  });
  ipcMain.handle("repertoires:refreshBackupPreview", (_event, jobId: unknown) =>
    refreshBackupPreview(asId(jobId, "jobId"))
  );
  ipcMain.handle("repertoires:cancelBackupImport", (_event, jobId: unknown) =>
    cancelBackupImport(asId(jobId, "jobId"))
  );
  ipcMain.handle("repertoires:startPractice", (_event, input: unknown) => {
    const parsed = parseStartPracticeInput(input);
    return withRepertoireWriteGate(() => startPractice(parsed));
  });
  ipcMain.handle("repertoires:resumePractice", (_event, sessionId: unknown) => {
    const parsed = asId(sessionId, "sessionId");
    return withRepertoireWriteGate(() => resumePractice(parsed));
  });
  ipcMain.handle("repertoires:recordPracticeAction", (_event, input: unknown) => {
    const parsed = parsePracticeActionInput(input);
    return withRepertoireWriteGate(() => recordPracticeAction(parsed));
  });
  ipcMain.handle("repertoires:recordAttempt", (_event, input: unknown) => {
    const parsed = parseRecordAttemptInput(input);
    return withRepertoireWriteGate(() => recordAttempt(parsed));
  });
  ipcMain.handle("repertoires:endPractice", (_event, sessionId: unknown) => {
    const parsed = asId(sessionId, "sessionId");
    return withRepertoireWriteGate(() => endPractice(parsed));
  });
  ipcMain.handle("repertoires:saveWorkspace", (_event, input: unknown) => {
    const parsed = parseSaveWorkspaceInput(input);
    return withRepertoireWriteGate(() => saveWorkspace(parsed));
  });
  ipcMain.handle("repertoires:getDueSummary", () => getDueSummary());
}
