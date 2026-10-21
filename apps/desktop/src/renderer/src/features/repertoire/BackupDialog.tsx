import { useState } from "react";
import { HardDriveDownload } from "lucide-react";
import type { ExportBackupResult } from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SettingRow } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Switch } from "@/components/ui/switch";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useExportBackupMutation, useRepertoiresQuery } from "../../queries/repertoire";
import { backupSummary } from "./backup";

/**
 * Back up every repertoire, archived ones included, to a native backup file (design §10): a
 * summary of what's included, whether practice progress goes with it, then the main-owned save
 * dialog. A cancelled save dialog closes this one quietly; a failure stays here until retried or
 * closed.
 */
export function BackupDialog({
  onClose,
  onSaved
}: {
  onClose: () => void;
  onSaved: (result: ExportBackupResult & { savedPath: string }) => void;
}) {
  // Summaries of the whole collection, archived ones included.
  const active = useRepertoiresQuery({ color: "all", archived: false });
  const archived = useRepertoiresQuery({ color: "all", archived: true });
  const exportBackup = useExportBackupMutation();
  const [includeProgress, setIncludeProgress] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const all = [...(active.data ?? []), ...(archived.data ?? [])];
  const counting = active.isPending || archived.isPending;
  const summary = counting ? "Counting repertoires…" : backupSummary(all);
  const empty = !counting && all.length === 0;

  function save() {
    setError(null);
    exportBackup.mutate(
      { includeProgress },
      {
        onSuccess: (result) => {
          const savedPath = result.savedPath;
          if (savedPath) onSaved({ ...result, savedPath });
          else onClose();
        },
        onError: (cause) => setError(ipcErrorMessage(cause) || "The backup couldn't be saved.")
      }
    );
  }

  return (
    <Dialog
      size="sm"
      title="Back up all repertoires"
      description={summary}
      onClose={onClose}
      bodyClassName="grid gap-3"
      footer={
        <>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={exportBackup.isPending || empty}
            onClick={save}
          >
            <HardDriveDownload />
            {exportBackup.isPending ? "Saving…" : "Save backup…"}
          </Button>
        </>
      }
    >
      <SettingRow
        label="Include practice progress"
        description="Recall schedules, so practice picks up where it left off after a restore."
        control={
          <Switch
            checked={includeProgress}
            onCheckedChange={setIncludeProgress}
            aria-label="Include practice progress"
          />
        }
      />
      <p className="text-xs leading-5 text-fg-subtle">
        Credentials, engine paths and cached evaluations are never included.
      </p>
      {empty ? <Notice tone="info">There are no repertoires to back up yet.</Notice> : null}
      {error ? (
        <Notice tone="danger" title="Backup failed">
          {error}
        </Notice>
      ) : null}
    </Dialog>
  );
}
