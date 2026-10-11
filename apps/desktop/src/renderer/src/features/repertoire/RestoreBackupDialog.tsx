import { FolderOpen, RefreshCw } from "lucide-react";
import type {
  BackupImportPreview,
  RestoreBackupInput,
  RestoreBackupResult
} from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { backupWarningsNotice } from "./backup";
import { plural } from "./repertoire-chapters";
import { BackupRepertoireList } from "./RestoreBackupList";
import { useBackupRestore } from "./useBackupRestore";

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
  const restore = useBackupRestore({ draft, onRestored });
  const { preview, error, busy } = restore;
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={restore.chooseFile}
            >
              <FolderOpen />
              Choose another file…
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!restore.canRestore}
              onClick={() => restore.restore()}
            >
              {restore.restoring
                ? "Restoring…"
                : `Restore ${plural(restore.included, "repertoire")}`}
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={restore.chooseFile}
            >
              <FolderOpen />
              {restore.reading ? "Reading…" : "Choose backup file…"}
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
      {restore.refreshed ? (
        <Notice tone="info">
          The preview was reloaded. Review the changes below before restoring.
        </Notice>
      ) : null}
      {preview ? (
        <BackupRepertoireList preview={preview} rows={restore.rows} dispatch={restore.dispatch} />
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
                onClick={restore.refreshPreview}
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
      {restore.confirmDraft ? (
        <DiscardDraftConfirm
          name={restore.confirmDraft}
          busy={busy}
          onCancel={restore.cancelConfirm}
          onConfirm={() => restore.restore(true)}
        />
      ) : null}
    </Dialog>
  );
}

/** Asks before a restore replaces the repertoire whose open study draft has unsaved edits. */
function DiscardDraftConfirm({
  name,
  busy,
  onCancel,
  onConfirm
}: {
  name: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      size="sm"
      title="Discard unsaved study edits?"
      description={`“${name}” has study edits that aren't saved yet.`}
      onClose={onCancel}
      footer={
        <>
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Keep editing
          </Button>
          <Button
            type="button"
            variant="ghost-destructive"
            size="sm"
            disabled={busy}
            onClick={onConfirm}
          >
            Discard edits and restore
          </Button>
        </>
      }
    >
      <p className="text-sm text-fg-secondary">
        Replacing it from the backup discards those edits. Cancel to go back and save them first.
      </p>
    </Dialog>
  );
}
