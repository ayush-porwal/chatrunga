/**
 * The repertoire authority (design §7–§10): revision checks, decision reconciliation, the derived
 * position index, progress invalidation, PGN import/export and practice grading. Every mutation
 * runs in one transaction; change events are broadcast only after it commits.
 *
 * The work lives in one module per area (service-runtime, repertoire-queries, repertoire-edits,
 * decision-edit, pgn-import-export, add-from-game, practice, rehearsal, backup-service); this is
 * the API the IPC handlers and tests use.
 */
import { forgetBackupJobs } from "./backup-service";
import { forgetImportJobs } from "./pgn-import-export";

export { setRepertoireClock, withRepertoireWriteGate } from "./service-runtime";
export {
  listRepertoires,
  getRepertoire,
  getChapter,
  getDecision,
  getPractisedElsewhere,
  getPausedKeys,
  getOccurrences,
  compareGame,
  getDueSummary
} from "./repertoire-queries";
export {
  createRepertoire,
  updateMetadata,
  saveChapter,
  removeChapter,
  updateChapters,
  duplicateRepertoire,
  archiveRepertoire,
  removeRepertoire,
  saveWorkspace
} from "./repertoire-edits";
export { updateDecision } from "./decision-edit";
export {
  setImportLimits,
  previewImport,
  commitImport,
  cancelImport,
  exportRepertoire
} from "./pgn-import-export";
export {
  previewAddFromGame,
  addFromGame,
  linkGame,
  listGameLinks,
  removeGameLink
} from "./add-from-game";
export {
  startPractice,
  recordAttempt,
  recordPracticeAction,
  resumePractice,
  endPractice
} from "./practice";
export {
  exportBackup,
  previewBackupImport,
  refreshBackupPreview,
  cancelBackupImport,
  restoreBackup
} from "./backup-service";

/** Forgets pending PGN import and backup restore jobs, cancelling running parses (tests). */
export function resetImportJobs(): void {
  forgetImportJobs();
  forgetBackupJobs();
}
