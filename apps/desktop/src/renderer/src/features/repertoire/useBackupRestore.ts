import { useEffect, useRef, useState } from "react";
import type {
  BackupImportPreview,
  RestoreBackupInput,
  RestoreBackupResult
} from "@chaturanga/shared/types/repertoire";
import { ipcErrorMessage } from "@/lib/ipc-error";
import {
  useCancelBackupImportMutation,
  usePreviewBackupImportMutation,
  useRefreshBackupPreviewMutation,
  useRestoreBackupMutation
} from "../../queries/repertoire";
import {
  buildRestoreInput,
  initialRestoreRows,
  replacedDirtyDraftName,
  restoreRowsReducer,
  type RestoreRowAction,
  type RestoreRowState
} from "./backup";
import { isStaleRevisionError } from "./repertoire-model";

/**
 * The restore job of the Restore from backup dialog: the picked file's preview (a pending job,
 * cancelled when the dialog closes before the restore), the choice per repertoire, the restore
 * itself, and the reload of the preview after a stale-revision refusal.
 */
export function useBackupRestore({
  draft,
  onRestored
}: {
  /** The open study draft; replacing its repertoire while it is dirty asks for confirmation. */
  draft: { repertoireId: string | null; dirty: boolean } | undefined;
  onRestored: (
    preview: BackupImportPreview,
    input: RestoreBackupInput,
    result: RestoreBackupResult
  ) => void;
}) {
  const previewMutation = usePreviewBackupImportMutation();
  const refreshMutation = useRefreshBackupPreviewMutation();
  const restoreMutation = useRestoreBackupMutation();
  const { mutate: cancelJobMutation } = useCancelBackupImportMutation();
  const [preview, setPreview] = useState<BackupImportPreview | null>(null);
  const [rows, setRows] = useState<RestoreRowState[]>([]);
  const [error, setError] = useState<{ message: string; stale: boolean } | null>(null);
  /** True once the preview was reloaded after a stale-revision refusal. */
  const [refreshed, setRefreshed] = useState(false);
  /** The name of the repertoire whose unsaved study edits the pending restore would discard. */
  const [confirmDraft, setConfirmDraft] = useState<string | null>(null);
  const pendingJob = useRef<string | null>(null);
  /** False once the dialog closed; a preview resolving after that cancels its job. */
  const open = useRef(true);
  /** Bumped per file pick: an older preview resolving late cancels its own job. */
  const previewRequest = useRef(0);

  /**
   * Cancels a pending job. After the dialog closed the hook's mutate may no longer run, so the API
   * is called directly then (best effort: an uncancelled job only expires on its own).
   */
  const cancelJob = (jobId: string) => {
    if (open.current) cancelJobMutation(jobId);
    else void window.chaturanga?.repertoires.cancelBackupImport(jobId).catch(() => undefined);
  };

  // Closing (or unmounting) with a previewed, unrestored job cancels it.
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
      const jobId = pendingJob.current;
      pendingJob.current = null;
      if (jobId) {
        void window.chaturanga?.repertoires.cancelBackupImport(jobId).catch(() => undefined);
      }
    };
  }, []);

  const dispatch = (action: RestoreRowAction) =>
    setRows((current) => restoreRowsReducer(preview, current, action));

  /** Opens a backup file; a cancelled open dialog keeps whatever was previewed before. */
  function chooseFile() {
    setError(null);
    const request = ++previewRequest.current;
    // The promise (unlike per-call callbacks) settles after the dialog unmounts too.
    previewMutation.mutateAsync({ pickFile: true }).then(
      (result) => {
        if (!open.current || request !== previewRequest.current) {
          if (result) cancelJob(result.jobId);
          return;
        }
        if (!result) return;
        if (pendingJob.current) cancelJob(pendingJob.current);
        pendingJob.current = result.jobId;
        setPreview(result);
        setRows(initialRestoreRows(result));
        setRefreshed(false);
      },
      (cause) => {
        if (open.current && request === previewRequest.current) {
          setError({
            message: ipcErrorMessage(cause) || "That backup couldn't be read.",
            stale: false
          });
        }
      }
    );
  }

  /**
   * After a stale-revision failure: recomputes the job's preview against the library as it is now,
   * so the fresh revisions and diffs are shown before Restore is offered again.
   */
  function refreshPreview() {
    if (!preview) return;
    const jobId = preview.jobId;
    refreshMutation.mutateAsync(jobId).then(
      (fresh) => {
        if (!open.current || pendingJob.current !== jobId) return;
        setPreview(fresh);
        setRows((current) =>
          restoreRowsReducer(fresh, current, { type: "refresh", preview: fresh })
        );
        setRefreshed(true);
        setError(null);
      },
      (cause) => {
        if (open.current) {
          setError({
            message:
              ipcErrorMessage(cause) ||
              "Couldn't reload the preview. Choose the file again, or restore as a new copy.",
            stale: false
          });
        }
      }
    );
  }

  function restore(confirmed = false) {
    if (!preview) return;
    const input = buildRestoreInput(preview, rows);
    if (!input.selections.length) return;
    const draftName = draft && !confirmed ? replacedDirtyDraftName(preview, input, draft) : null;
    if (draftName) {
      setConfirmDraft(draftName);
      return;
    }
    setConfirmDraft(null);
    setError(null);
    restoreMutation.mutate(input, {
      onSuccess: (result) => {
        pendingJob.current = null;
        onRestored(preview, input, result);
      },
      onError: (cause) => {
        const message = ipcErrorMessage(cause) || "The backup couldn't be restored.";
        const replacing = input.selections.some((selection) => selection.mode === "replace");
        setError({ message, stale: replacing && isStaleRevisionError(message) });
      }
    });
  }

  const included = rows.filter((row) => row.include).length;
  const busy = previewMutation.isPending || restoreMutation.isPending || refreshMutation.isPending;

  return {
    preview,
    rows,
    dispatch,
    error,
    refreshed,
    confirmDraft,
    cancelConfirm: () => setConfirmDraft(null),
    included,
    busy,
    reading: previewMutation.isPending,
    restoring: restoreMutation.isPending,
    // After a stale-revision refusal, Restore stays off until the preview is reloaded.
    canRestore: !busy && included > 0 && !error?.stale,
    chooseFile,
    refreshPreview,
    restore
  };
}
