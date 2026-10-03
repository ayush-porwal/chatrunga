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
  getOccurrences,
  getDueSummary,
  getRepertoire,
  linkGame,
  listGameLinks,
  listRepertoires,
  previewAddFromGame,
  previewBackupImport,
  previewImport,
  queueRepertoireWrite,
  recordAttempt,
  recordPracticeAction,
  refreshBackupPreview,
  removeChapter,
  removeGameLink,
  removeRepertoire,
  restoreBackup,
  resumePractice,
  saveChapter,
  saveWorkspace,
  startPractice,
  updateDecision,
  updateMetadata
} from "../repertoire/service";
import {
  asId,
  parseAddFromGameInput,
  parseArchiveRepertoireInput,
  parseChapterRef,
  parseCompareGameInput,
  parseDecisionRef,
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
 * Writes to one repertoire are queued behind a running import commit (`queueRepertoireWrite`).
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
    return queueRepertoireWrite(parsed.repertoireId, () => addFromGame(parsed));
  });
  ipcMain.handle("repertoires:listGameLinks", (_event, input: unknown) =>
    listGameLinks(parseGameLinkQuery(input))
  );
  ipcMain.handle("repertoires:removeGameLink", (_event, input: unknown) =>
    removeGameLink(parseRemoveGameLink(input))
  );
  ipcMain.handle("repertoires:linkGame", (_event, input: unknown) => {
    const parsed = parseLinkGameInput(input);
    return queueRepertoireWrite(parsed.repertoireId, () => linkGame(parsed));
  });
  ipcMain.handle("repertoires:create", (_event, input: unknown) =>
    createRepertoire(parseCreateRepertoireInput(input))
  );
  ipcMain.handle("repertoires:updateMetadata", (_event, input: unknown) => {
    const parsed = parseUpdateRepertoireMetadataInput(input);
    return queueRepertoireWrite(parsed.id, () => updateMetadata(parsed));
  });
  ipcMain.handle("repertoires:saveChapter", (_event, input: unknown) => {
    const parsed = parseSaveChapterInput(input);
    return queueRepertoireWrite(parsed.repertoireId, () => saveChapter(parsed));
  });
  ipcMain.handle("repertoires:updateDecision", (_event, input: unknown) => {
    const parsed = parseUpdateDecisionInput(input);
    return queueRepertoireWrite(parsed.repertoireId, () => updateDecision(parsed));
  });
  ipcMain.handle("repertoires:removeChapter", (_event, input: unknown) => {
    const parsed = parseRemoveChapterInput(input);
    return queueRepertoireWrite(parsed.repertoireId, () => removeChapter(parsed));
  });
  ipcMain.handle("repertoires:duplicate", (_event, input: unknown) =>
    duplicateRepertoire(parseDuplicateRepertoireInput(input))
  );
  ipcMain.handle("repertoires:archive", (_event, input: unknown) => {
    const parsed = parseArchiveRepertoireInput(input);
    return queueRepertoireWrite(parsed.id, () => archiveRepertoire(parsed));
  });
  ipcMain.handle("repertoires:remove", (_event, input: unknown) => {
    const parsed = parseRemoveRepertoireInput(input);
    return queueRepertoireWrite(parsed.id, () => removeRepertoire(parsed));
  });
  ipcMain.handle("repertoires:previewImport", (_event, input: unknown) =>
    previewImport(parsePreviewImportInput(input))
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
  ipcMain.handle("repertoires:restoreBackup", (_event, input: unknown) =>
    restoreBackup(parseRestoreBackupInput(input))
  );
  ipcMain.handle("repertoires:refreshBackupPreview", (_event, jobId: unknown) =>
    refreshBackupPreview(asId(jobId, "jobId"))
  );
  ipcMain.handle("repertoires:cancelBackupImport", (_event, jobId: unknown) =>
    cancelBackupImport(asId(jobId, "jobId"))
  );
  ipcMain.handle("repertoires:startPractice", (_event, input: unknown) =>
    startPractice(parseStartPracticeInput(input))
  );
  ipcMain.handle("repertoires:resumePractice", (_event, sessionId: unknown) =>
    resumePractice(asId(sessionId, "sessionId"))
  );
  ipcMain.handle("repertoires:recordPracticeAction", (_event, input: unknown) =>
    recordPracticeAction(parsePracticeActionInput(input))
  );
  ipcMain.handle("repertoires:recordAttempt", (_event, input: unknown) =>
    recordAttempt(parseRecordAttemptInput(input))
  );
  ipcMain.handle("repertoires:endPractice", (_event, sessionId: unknown) =>
    endPractice(asId(sessionId, "sessionId"))
  );
  ipcMain.handle("repertoires:saveWorkspace", (_event, input: unknown) => {
    const parsed = parseSaveWorkspaceInput(input);
    return queueRepertoireWrite(parsed.repertoireId, () => saveWorkspace(parsed));
  });
  ipcMain.handle("repertoires:getDueSummary", () => getDueSummary());
}
