import { memo, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { externalDatabaseSources } from "@chaturanga/shared/types/database";
import type { InstalledDatabase } from "@chaturanga/shared/types/database";
import {
  useDatabasesQuery,
  useDeleteDatabaseMutation,
  useDownloadDatabaseMutation
} from "../../queries/api";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { Page, PageHeader } from "@/components/ui/page";
import { hasDesktopApi } from "@/lib/environment";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useDownloadStore } from "../../stores/download-store";
import { DatabaseCard, DatabaseCardSkeleton } from "./DatabaseCard";

export const DatabasePage = memo(function DatabasePage({
  onTrain
}: {
  onTrain: (databaseId: string) => void;
}) {
  const databases = useDatabasesQuery();
  const downloadDatabase = useDownloadDatabaseMutation();
  const deleteDatabase = useDeleteDatabaseMutation();
  const desktopApiAvailable = hasDesktopApi();
  // Kept for the whole app (useDatabaseDownloads): a download started earlier still shows here.
  const downloadProgress = useDownloadStore((state) => state.progress);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<InstalledDatabase | null>(null);
  const installedBySource = new Map(databases.data?.map((item) => [item.sourceId, item]));

  async function removeDatabase(database: InstalledDatabase) {
    if (!desktopApiAvailable) return;
    setDeleteError(null);
    try {
      await deleteDatabase.mutateAsync(database.id);
    } catch (error) {
      setDeleteError(
        `Couldn't delete ${database.name}: ${ipcErrorMessage(error) || "unknown error"}`
      );
    }
  }

  return (
    <Page>
      <PageHeader title="Databases" />
      {!desktopApiAvailable ? (
        <Notice tone="warn">
          Database downloads and local file management require the desktop app.
        </Notice>
      ) : null}
      {databases.isError ? (
        <Notice
          tone="danger"
          title="Couldn't read your databases"
          action={
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => void databases.refetch()}
            >
              <RotateCcw />
              Try again
            </Button>
          }
        >
          {ipcErrorMessage(databases.error) ||
            "The list of installed databases couldn't be loaded."}
        </Notice>
      ) : null}
      {deleteError ? <Notice tone="danger">{deleteError}</Notice> : null}

      {/* Without the list, a card can't tell whether its database is downloaded: none are shown. */}
      {databases.isError ? null : (
        // As many columns of at least 28rem as fit (one on a narrow window, up to three on a wide
        // one); every row as tall as the tallest card, so the cards line up.
        <div className="grid auto-rows-fr grid-cols-[repeat(auto-fill,minmax(min(100%,28rem),1fr))] gap-4">
          {databases.isPending && desktopApiAvailable
            ? externalDatabaseSources.map((source) => <DatabaseCardSkeleton key={source.id} />)
            : externalDatabaseSources.map((source) => (
                <DatabaseCard
                  key={source.id}
                  source={source}
                  installed={installedBySource.get(source.id)}
                  progress={downloadProgress[source.id]}
                  starting={downloadDatabase.isPending && downloadDatabase.variables === source.id}
                  downloadDisabled={!desktopApiAvailable || downloadDatabase.isPending}
                  deleteDisabled={!desktopApiAvailable || deleteDatabase.isPending}
                  onDownload={() => downloadDatabase.mutate(source.id)}
                  onCancel={() => void window.chaturanga?.databases.cancelDownload(source.id)}
                  onDelete={setConfirmingDelete}
                  onTrain={onTrain}
                />
              ))}
        </div>
      )}

      {confirmingDelete ? (
        <Dialog
          size="sm"
          title={`Delete ${confirmingDelete.name}?`}
          description="The downloaded file will be removed from disk."
          onClose={() => setConfirmingDelete(null)}
          footer={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmingDelete(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="ghost-destructive"
                size="sm"
                className="border-danger/35 bg-danger-soft text-danger"
                onClick={() => {
                  setConfirmingDelete(null);
                  void removeDatabase(confirmingDelete);
                }}
              >
                <Trash2 />
                Delete
              </Button>
            </>
          }
        />
      ) : null}
    </Page>
  );
});
