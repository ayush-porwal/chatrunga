import { useEffect, useRef, useState } from "react";
import { FolderOpen, RefreshCw } from "lucide-react";
import type {
  BackupImportPreview,
  RestoreBackupInput,
  RestoreBackupResult
} from "@chaturanga/shared/types/repertoire";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SideDot } from "@/components/ui/side-dot";
import { Switch } from "@/components/ui/switch";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { well } from "@/lib/ui";
import { cn } from "@/lib/utils";
import {
  useCancelBackupImportMutation,
  usePreviewBackupImportMutation,
  useRefreshBackupPreviewMutation,
  useRestoreBackupMutation
} from "../../queries/repertoire";
import {
  backupWarningsNotice,
  buildRestoreInput,
  canReplace,
  initialRestoreRows,
  replacedDirtyDraftName,
  restoreDiffLine,
  restoreLossLines,
  restoreMetadataLine,
  restoreRowsReducer,
  type RestoreRowAction,
  type RestoreRowState
} from "./backup";
import { COLOR_LABELS, plural } from "./repertoire-chapters";
import { isStaleRevisionError } from "./repertoire-model";

type ModeValue = RestoreRowState["mode"];

/**
 * Restore repertoires from a native backup (design §10): pick a file in the main-owned open
 * dialog, review what it holds and what replacing would change (including the progress and
 * practice history a replace discards), then restore the chosen ones as new copies (the default)
 * or over their existing repertoire (a backup of which is kept first). Replacing the repertoire of
 * a dirty study draft asks first. After a stale-revision refusal, Restore stays off until the
 * preview is reloaded and its fresh diff shown. Closing before the restore cancels the pending
 * job; a failure stays in the dialog.
 */
export function RestoreBackupDialog({
  draft,
  onClose,
  onRestored
}: {
  /** The open study draft; replacing its repertoire while it is dirty asks for confirmation. */
  draft?: { repertoireId: string | null; dirty: boolean };
  onClose: () => void;
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
  const warnings = preview ? backupWarningsNotice(preview.warnings) : null;

  return (
    <Dialog
      title="Restore from backup"
      description={
        preview
          ? `Exported ${new Date(preview.exportedAt).toLocaleString()} · ${preview.app.name} ${preview.app.version} · format ${preview.formatVersion}`
          : "Choose a Chaturanga repertoire backup. Nothing changes until you restore."
      }
      onClose={onClose}
      bodyClassName="grid gap-3"
      footer={
        preview ? (
          <>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={chooseFile}>
              <FolderOpen />
              Choose another file…
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={busy || !included || Boolean(error?.stale)}
              onClick={() => restore()}
            >
              {restoreMutation.isPending
                ? "Restoring…"
                : `Restore ${plural(included, "repertoire")}`}
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" variant="primary" size="sm" disabled={busy} onClick={chooseFile}>
              <FolderOpen />
              {previewMutation.isPending ? "Reading…" : "Choose backup file…"}
            </Button>
          </>
        )
      }
    >
      {warnings ? (
        <Notice tone="warn" title={warnings.title}>
          {warnings.lines.join("\n")}
        </Notice>
      ) : null}
      {refreshed ? (
        <Notice tone="info">
          The preview was reloaded. Review the changes below before restoring.
        </Notice>
      ) : null}
      {preview ? (
        preview.repertoires.length ? (
          <ul className="grid gap-2" aria-label="Repertoires in the backup">
            {preview.repertoires.map((item) => {
              const row = rows.find((entry) => entry.sourceId === item.sourceId);
              if (!row) return null;
              const replacing = row.mode === "replace" && item.existing;
              const otherColor = Boolean(item.existing) && !canReplace(item);
              const restoringProgress = item.hasProgress && row.includeProgress;
              const metadataLine = item.diff ? restoreMetadataLine(item.diff) : null;
              const lossLines = item.diff ? restoreLossLines(item.diff, restoringProgress) : [];
              const modeOptions: { value: ModeValue; label: string; disabled?: boolean }[] = [
                { value: "new-copy", label: "New copy" },
                { value: "replace", label: "Replace existing", disabled: !canReplace(item) }
              ];
              return (
                <li
                  key={item.sourceId}
                  className={cn(well, "grid gap-2 p-3", !row.include && "opacity-70")}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-4 accent-accent"
                      aria-label={`Restore ${item.name}`}
                      checked={row.include}
                      onChange={(event) =>
                        dispatch({
                          type: "include",
                          sourceId: item.sourceId,
                          include: event.target.checked
                        })
                      }
                    />
                    <SideDot color={item.color} size="md" />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate text-sm font-medium text-fg">{item.name}</span>
                      <span className="truncate text-xs text-fg-muted">
                        {COLOR_LABELS[item.color]} · {plural(item.chapterCount, "chapter")} ·{" "}
                        {plural(item.decisionCount, "decision")}
                      </span>
                    </span>
                    {item.hasProgress ? <Badge>Has progress</Badge> : null}
                  </div>
                  {row.include ? (
                    <div className="grid gap-2 pl-6">
                      <div className="flex flex-wrap items-center gap-3">
                        <SegmentedControl
                          ariaLabel={`How to restore ${item.name}`}
                          role="radiogroup"
                          size="sm"
                          value={row.mode}
                          onChange={(mode) =>
                            dispatch({ type: "mode", sourceId: item.sourceId, mode })
                          }
                          options={modeOptions}
                        />
                        {item.hasProgress ? (
                          <label className="flex items-center gap-2 text-xs text-fg-secondary">
                            <Switch
                              checked={row.includeProgress}
                              onCheckedChange={(includeProgress) =>
                                dispatch({
                                  type: "progress",
                                  sourceId: item.sourceId,
                                  includeProgress
                                })
                              }
                              aria-label={`Include progress for ${item.name}`}
                            />
                            Include progress
                          </label>
                        ) : null}
                      </div>
                      {otherColor && item.existing ? (
                        <p className="text-xs text-fg-muted">
                          “{item.existing.name}” here is a{" "}
                          {COLOR_LABELS[item.color === "white" ? "black" : "white"].toLowerCase()}{" "}
                          repertoire, so this one can only be restored as a new copy.
                        </p>
                      ) : null}
                      {replacing && item.existing ? (
                        <>
                          <p className="text-xs text-fg-muted">
                            Replaces “{item.existing.name}” (revision {item.existing.revision})
                            {item.diff ? ` · ${restoreDiffLine(item.diff, restoringProgress)}` : ""}
                            {metadataLine ? ` · ${metadataLine}` : ""}
                          </p>
                          {item.damaged ? (
                            <Notice tone="warn" appear={false}>
                              “{item.existing.name}” has a damaged chapter, so the changes can’t be
                              listed. Its stored data is kept in the backup saved first.
                            </Notice>
                          ) : null}
                          <Notice
                            tone="danger"
                            appear={false}
                            title={lossLines.length ? `${lossLines.join(". ")}.` : undefined}
                          >
                            Replacing overwrites “{item.existing.name}”, and its practice history is
                            lost. A backup of it is saved first.
                          </Notice>
                        </>
                      ) : (
                        <Input
                          aria-label={`Name for the restored copy of ${item.name}`}
                          className="h-8"
                          value={row.newName}
                          onChange={(event) =>
                            dispatch({
                              type: "name",
                              sourceId: item.sourceId,
                              newName: event.target.value
                            })
                          }
                        />
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <Notice tone="info">This backup has no repertoires.</Notice>
        )
      ) : null}
      {error ? (
        <Notice
          tone="danger"
          title={preview ? "Restore failed" : "Couldn't read the backup"}
          action={
            error.stale ? (
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={busy}
                onClick={refreshPreview}
              >
                <RefreshCw />
                Reload preview
              </Button>
            ) : undefined
          }
        >
          {error.message}
        </Notice>
      ) : null}
      {confirmDraft ? (
        <Dialog
          size="sm"
          title="Discard unsaved study edits?"
          description={`“${confirmDraft}” has study edits that aren't saved yet.`}
          onClose={() => setConfirmDraft(null)}
          footer={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmDraft(null)}
              >
                Keep editing
              </Button>
              <Button
                type="button"
                variant="ghost-destructive"
                size="sm"
                disabled={busy}
                onClick={() => restore(true)}
              >
                Discard edits and restore
              </Button>
            </>
          }
        >
          <p className="text-sm text-fg-secondary">
            Replacing it from the backup discards those edits. Cancel to go back and save them
            first.
          </p>
        </Dialog>
      ) : null}
    </Dialog>
  );
}
