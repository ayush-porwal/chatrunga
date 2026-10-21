import { useState } from "react";
import { HardDriveDownload, HardDriveUpload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingRow } from "@/components/ui/field";
import { SectionHeader } from "@/components/ui/page";
import { cardPadded } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { formatBytes, restoreNotice, shortenPath } from "./backup";
import { BackupDialog } from "./BackupDialog";
import { HubNotice, type HubMessage } from "./HubNotice";
import { plural } from "./repertoire-chapters";
import { RestoreBackupDialog } from "./RestoreBackupDialog";

/**
 * Settings → Repertoire backups: back up every repertoire to a file, or restore from one (both
 * through main-owned native dialogs, so only in the desktop app). The outcome stays in the card
 * until dismissed.
 */
export function RepertoireBackupSection() {
  const [dialog, setDialog] = useState<"backup" | "restore" | null>(null);
  const [notice, setNotice] = useState<HubMessage | null>(null);
  // The open study draft, so a restore that replaces its repertoire can ask before discarding it.
  const draftRepertoireId = useRepertoireWorkspaceStore((state) => state.repertoireId);
  const draftDirty = useRepertoireWorkspaceStore((state) => state.dirty);
  return (
    <section className={cn(cardPadded, "grid content-start gap-2")}>
      <SectionHeader
        title="Repertoire backups"
        description="Every repertoire in one file, archived ones included: to move them to another computer or keep a copy."
      />
      <div className="grid divide-y divide-line-subtle">
        <SettingRow
          label="Back up"
          description="Chapters, notes and choices; practice progress optional."
          control={
            <Button type="button" variant="outline" size="sm" onClick={() => setDialog("backup")}>
              <HardDriveDownload />
              Back up all repertoires…
            </Button>
          }
        />
        <SettingRow
          label="Restore"
          description="As new copies, or over the repertoires they came from."
          control={
            <Button type="button" variant="outline" size="sm" onClick={() => setDialog("restore")}>
              <HardDriveUpload />
              Restore from backup…
            </Button>
          }
        />
      </div>
      {notice ? <HubNotice notice={notice} onChange={setNotice} /> : null}
      {dialog === "backup" ? (
        <BackupDialog
          onClose={() => setDialog(null)}
          onSaved={(result) => {
            setDialog(null);
            setNotice({
              tone: "success",
              text: `Backup saved (${plural(result.repertoireCount, "repertoire")}, ${formatBytes(result.bytes)}) to ${shortenPath(result.savedPath)}.`,
              details: result.warnings,
              path: result.savedPath
            });
          }}
        />
      ) : null}
      {dialog === "restore" ? (
        <RestoreBackupDialog
          draft={{ repertoireId: draftRepertoireId, dirty: draftDirty }}
          onClose={() => setDialog(null)}
          onRestored={(preview, input, result) => {
            setDialog(null);
            // A replaced repertoire's open study draft describes content that no longer exists
            // (the dialog asked first when the draft had unsaved edits).
            const draft = useRepertoireWorkspaceStore.getState();
            const replaced = result.restored.some(
              (item) => item.mode === "replace" && item.repertoireId === draft.repertoireId
            );
            if (replaced) draft.reset();
            const message = restoreNotice(preview, input, result);
            setNotice({ tone: "success", text: message.text, details: message.details });
          }}
        />
      ) : null}
    </section>
  );
}
