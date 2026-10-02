import { BrowserWindow, ipcMain } from "electron";
import {
  addFromGame,
  archiveRepertoire,
  cancelImport,
  commitImport,
  compareGame,
  createRepertoire,
  duplicateRepertoire,
  endPractice,
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
  previewImport,
  recordAttempt,
  recordPracticeAction,
  removeChapter,
  removeGameLink,
  removeRepertoire,
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
  parseExportInput,
  parseGameLinkQuery,
  parseImportCommitInput,
  parseLinkGameInput,
  parsePracticeActionInput,
  parsePreviewImportInput,
  parseRecordAttemptInput,
  parseRemoveChapterInput,
  parseRemoveGameLink,
  parseRemoveRepertoireInput,
  parseRepertoireListFilters,
  parseSaveChapterInput,
  parseSaveWorkspaceInput,
  parseStartPracticeInput,
  parseUpdateDecisionInput,
  parseUpdateRepertoireMetadataInput
} from "./validate";

/** Repertoires (main/repertoire/service.ts): every input is parsed before the service sees it. */
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
  ipcMain.handle("repertoires:addFromGame", (_event, input: unknown) =>
    addFromGame(parseAddFromGameInput(input))
  );
  ipcMain.handle("repertoires:listGameLinks", (_event, input: unknown) =>
    listGameLinks(parseGameLinkQuery(input))
  );
  ipcMain.handle("repertoires:removeGameLink", (_event, input: unknown) =>
    removeGameLink(parseRemoveGameLink(input))
  );
  ipcMain.handle("repertoires:linkGame", (_event, input: unknown) =>
    linkGame(parseLinkGameInput(input))
  );
  ipcMain.handle("repertoires:create", (_event, input: unknown) =>
    createRepertoire(parseCreateRepertoireInput(input))
  );
  ipcMain.handle("repertoires:updateMetadata", (_event, input: unknown) =>
    updateMetadata(parseUpdateRepertoireMetadataInput(input))
  );
  ipcMain.handle("repertoires:saveChapter", (_event, input: unknown) =>
    saveChapter(parseSaveChapterInput(input))
  );
  ipcMain.handle("repertoires:updateDecision", (_event, input: unknown) =>
    updateDecision(parseUpdateDecisionInput(input))
  );
  ipcMain.handle("repertoires:removeChapter", (_event, input: unknown) =>
    removeChapter(parseRemoveChapterInput(input))
  );
  ipcMain.handle("repertoires:duplicate", (_event, input: unknown) =>
    duplicateRepertoire(parseDuplicateRepertoireInput(input))
  );
  ipcMain.handle("repertoires:archive", (_event, input: unknown) =>
    archiveRepertoire(parseArchiveRepertoireInput(input))
  );
  ipcMain.handle("repertoires:remove", (_event, input: unknown) =>
    removeRepertoire(parseRemoveRepertoireInput(input))
  );
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
  ipcMain.handle("repertoires:saveWorkspace", (_event, input: unknown) =>
    saveWorkspace(parseSaveWorkspaceInput(input))
  );
  ipcMain.handle("repertoires:getDueSummary", () => getDueSummary());
}
