import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Copy,
  Download,
  GraduationCap,
  HardDriveDownload,
  Library,
  Pencil,
  Play,
  Trash2,
  Upload
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { RepertoireSummary } from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import type { MenuItem } from "@/components/ui/menu";
import { Page, PageHeader } from "@/components/ui/page";
import { hasDesktopApi } from "@/lib/environment";
import { ipcErrorMessage } from "@/lib/ipc-error";
import {
  repertoireKeys,
  useArchiveRepertoireMutation,
  useDuplicateRepertoireMutation,
  useExportRepertoireMutation,
  useRemoveChapterMutation,
  useRemoveRepertoireMutation,
  useRepertoiresQuery
} from "../../queries/repertoire";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { formatBytes, restoreNotice, shortenPath } from "./backup";
import { BackupDialog } from "./BackupDialog";
import { CreateRepertoireDialog } from "./CreateRepertoireDialog";
import { EditRepertoireDialog } from "./EditRepertoireDialog";
import { HubNotice, type HubMessage } from "./HubNotice";
import { ImportPgnDialog } from "./ImportPgnDialog";
import { BackupMenu, HubStartActions } from "./RepertoireHubActions";
import { HubEmptyState, HubFilterBar, RepertoireList } from "./RepertoireHubList";
import { RestoreBackupDialog } from "./RestoreBackupDialog";
import {
  plural,
  sortedChapters,
  type ResumePracticeTarget,
  type StudyTarget
} from "./repertoire-chapters";
import { useHubFilters, useHubTargets } from "./useRepertoireHub";

/** Backups go through main-owned native dialogs, so they're hidden outside the desktop app. */
function nativeBackupsAvailable(): boolean {
  return hasDesktopApi() && typeof window.chaturanga?.repertoires.exportBackup === "function";
}

/**
 * The repertoire hub (§5.1): review what's due, create, filter and search repertoires, and act on
 * each one (study, practice, import/export PGN, back up, duplicate, archive, delete). Native backup
 * and restore live in the header's Backup menu (desktop only).
 */
export function RepertoireHubPage({
  onStudy,
  onPractice,
  onResume,
  onReview
}: {
  onStudy: (target: StudyTarget) => void;
  onPractice: (repertoireId: string) => void;
  /** The unfinished practice session (e.g. after a restart). */
  onResume: (target: ResumePracticeTarget) => void;
  /** Practice set up as a review of everything due. */
  onReview: (repertoireId: string) => void;
}) {
  const desktop = Boolean(window.chaturanga?.repertoires);
  const backups = desktop && nativeBackupsAvailable();
  const queryClient = useQueryClient();
  const filters = useHubFilters();
  // "Last studied" is relative to when the hub opened (render stays pure).
  const [now] = useState(() => Date.now());
  const list = useRepertoiresQuery(filters.listFilters);
  const targets = useHubTargets();
  const duplicate = useDuplicateRepertoireMutation();
  const archive = useArchiveRepertoireMutation();
  const remove = useRemoveRepertoireMutation();
  const removeChapter = useRemoveChapterMutation();
  /** The empty first chapter of a repertoire created to import into; the import replaces it. */
  const [placeholder, setPlaceholder] = useState<{
    repertoireId: string;
    chapterId: string;
  } | null>(null);
  const exportMutation = useExportRepertoireMutation();
  const [creating, setCreating] = useState(false);
  const [importTarget, setImportTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<RepertoireSummary | null>(null);
  const [editing, setEditing] = useState<RepertoireSummary | null>(null);
  /** The backup dialog's scope: every repertoire, or one. */
  const [backupTarget, setBackupTarget] = useState<"all" | RepertoireSummary | null>(null);
  const [restoring, setRestoring] = useState(false);
  // The open study draft, so a restore that replaces its repertoire can ask before discarding it.
  const draftRepertoireId = useRepertoireWorkspaceStore((state) => state.repertoireId);
  const draftDirty = useRepertoireWorkspaceStore((state) => state.dirty);
  const [notice, setNotice] = useState<HubMessage | null>(null);
  const { resume } = targets;

  const fail = (error: unknown, fallback: string) =>
    setNotice({ tone: "danger", text: ipcErrorMessage(error) || fallback });

  /** Study opens the last chapter studied, else the first one. */
  async function study(id: string) {
    const api = window.chaturanga?.repertoires;
    if (!api) return;
    try {
      const detail = await queryClient.fetchQuery({
        queryKey: repertoireKeys.detail(id),
        queryFn: () => api.get(id)
      });
      const last = detail.workspace?.lastChapterId;
      const chapter =
        detail.chapters.find((item) => item.id === last) ?? sortedChapters(detail.chapters).at(0);
      if (!chapter) {
        setNotice({
          tone: "info",
          text: "This repertoire has no chapters yet. Import a PGN to add some."
        });
        return;
      }
      onStudy({
        repertoireId: id,
        chapterId: chapter.id,
        nodeId: chapter.id === last ? (detail.workspace?.lastNodeId ?? null) : null
      });
    } catch (error) {
      fail(error, "Couldn't open that repertoire.");
    }
  }

  function exportPgn(item: RepertoireSummary) {
    setNotice(null);
    exportMutation.mutate(
      { repertoireId: item.id },
      {
        onSuccess: (result) => {
          if (result.savedPath) {
            setNotice({
              tone: "success",
              text: `Exported ${plural(result.chapterCount, "chapter")} to ${result.savedPath}.`
            });
          } else if (result.pgn.trim()) {
            setNotice({ tone: "info", text: "The PGN wasn't saved to a file.", pgn: result.pgn });
          }
        },
        onError: (error) => fail(error, "Couldn't export the PGN.")
      }
    );
  }

  /** A repertoire's menu: study, practice, edit, import/export, back up, duplicate, archive, delete. */
  function actionsFor(item: RepertoireSummary): (MenuItem | false)[] {
    return [
      { label: "Study", icon: <BookOpen />, onSelect: () => void study(item.id) },
      ...(resume?.repertoireId === item.id
        ? [
            {
              label: resume.label,
              icon: <Play />,
              onSelect: () => onResume(resume)
            }
          ]
        : []),
      {
        label: "Practice",
        icon: <GraduationCap />,
        // The main process refuses practice on an archived repertoire.
        disabled: Boolean(item.archivedAt),
        onSelect: () => onPractice(item.id)
      },
      {
        label: "Edit repertoire",
        icon: <Pencil />,
        onSelect: () => setEditing(item)
      },
      {
        label: "Import PGN",
        icon: <Upload />,
        onSelect: () => setImportTarget(item.id)
      },
      { label: "Export PGN", icon: <Download />, onSelect: () => exportPgn(item) },
      backups && {
        label: "Back up this repertoire…",
        icon: <HardDriveDownload />,
        onSelect: () => setBackupTarget(item)
      },
      {
        label: "Duplicate",
        icon: <Copy />,
        onSelect: () =>
          duplicate.mutate(
            { id: item.id },
            {
              onSuccess: (copy) => setNotice({ tone: "success", text: `Created “${copy.name}”.` }),
              onError: (error) => fail(error, "Couldn't duplicate it.")
            }
          )
      },
      {
        label: item.archivedAt ? "Unarchive" : "Archive",
        icon: item.archivedAt ? <ArchiveRestore /> : <Archive />,
        onSelect: () =>
          archive.mutate(
            {
              id: item.id,
              archived: !item.archivedAt,
              expectedRevision: item.revision
            },
            { onError: (error) => fail(error, "Couldn't change it.") }
          )
      },
      {
        label: "Delete",
        icon: <Trash2 />,
        destructive: true,
        onSelect: () => setDeleting(item)
      }
    ];
  }

  function confirmDelete(repertoire: RepertoireSummary) {
    remove.mutate(
      { id: repertoire.id, expectedRevision: repertoire.revision },
      {
        onSuccess: (_result, input) => {
          setDeleting(null);
          // Its draft (even an unsaved or failed one) has nowhere to be saved now.
          const draft = useRepertoireWorkspaceStore.getState();
          if (draft.repertoireId === input.id) draft.reset();
        },
        onError: (error) => {
          setDeleting(null);
          fail(error, "Couldn't delete it.");
        }
      }
    );
  }

  if (!desktop) {
    return (
      <Page>
        <PageHeader title="Repertoire" />
        <EmptyState
          icon={<Library />}
          title="Repertoires need the desktop app"
          description="Your repertoires, practice schedule and progress are stored by the app."
        />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Repertoire"
        description="Build the openings you play, then practise one decision at a time."
        actions={
          <>
            {backups ? (
              <BackupMenu
                onBackUpAll={() => setBackupTarget("all")}
                onRestore={() => setRestoring(true)}
              />
            ) : null}
            <HubStartActions
              targets={targets}
              onStudy={onStudy}
              onResume={onResume}
              onReview={onReview}
              onCreate={() => setCreating(true)}
            />
          </>
        }
      />

      <HubFilterBar filters={filters} />

      {notice ? <HubNotice notice={notice} onChange={setNotice} /> : null}

      <RepertoireList
        list={list}
        now={now}
        onStudy={(id) => void study(id)}
        actionsFor={actionsFor}
        empty={<HubEmptyState filters={filters} onCreate={() => setCreating(true)} />}
      />

      {creating ? (
        <CreateRepertoireDialog
          onClose={() => setCreating(false)}
          onCreated={(detail, next) => {
            setCreating(false);
            const first = sortedChapters(detail.chapters).at(0);
            if (next === "import") {
              setImportTarget(detail.id);
              setPlaceholder(first ? { repertoireId: detail.id, chapterId: first.id } : null);
            } else if (next === "study" && first) {
              onStudy({ repertoireId: detail.id, chapterId: first.id, nodeId: null });
            }
            // "add-game": the Add to repertoire dialog is open over the hub.
          }}
        />
      ) : null}
      {editing ? (
        <EditRepertoireDialog
          repertoire={editing}
          onClose={() => setEditing(null)}
          onSaved={(detail) => {
            setEditing(null);
            setNotice({ tone: "success", text: `Saved the details of “${detail.name}”.` });
          }}
        />
      ) : null}
      {importTarget ? (
        <ImportPgnDialog
          repertoireId={importTarget}
          onClose={() => {
            setImportTarget(null);
            setPlaceholder(null);
          }}
          onImported={(result) => {
            setImportTarget(null);
            setPlaceholder(null);
            const empty = result.repertoire.chapters.find(
              (chapter) =>
                chapter.id === placeholder?.chapterId &&
                result.repertoire.id === placeholder.repertoireId &&
                chapter.nodeCount === 0
            );
            if (empty && result.chaptersAdded > 0) {
              removeChapter.mutate({
                repertoireId: result.repertoire.id,
                chapterId: empty.id,
                expectedRevision: result.repertoire.revision
              });
            }
            setNotice({
              tone: "success",
              text: `Imported ${plural(result.chaptersAdded, "chapter")} into “${result.repertoire.name}”.`
            });
          }}
        />
      ) : null}
      {backupTarget ? (
        <BackupDialog
          repertoire={backupTarget === "all" ? undefined : backupTarget}
          onClose={() => setBackupTarget(null)}
          onSaved={(result) => {
            setBackupTarget(null);
            setNotice({
              tone: "success",
              text: `Backup saved (${plural(result.repertoireCount, "repertoire")}, ${formatBytes(result.bytes)}) to ${shortenPath(result.savedPath)}.`,
              details: result.warnings,
              path: result.savedPath
            });
          }}
        />
      ) : null}
      {restoring ? (
        <RestoreBackupDialog
          draft={{ repertoireId: draftRepertoireId, dirty: draftDirty }}
          onClose={() => setRestoring(false)}
          onRestored={(preview, input, result) => {
            setRestoring(false);
            // A replaced repertoire's open study draft describes content that no longer exists
            // (the dialog asked first when the draft had unsaved edits).
            const draft = useRepertoireWorkspaceStore.getState();
            const replaced = result.restored.some(
              (item) => item.mode === "replace" && item.repertoireId === draft.repertoireId
            );
            if (replaced) draft.reset();
            const message = restoreNotice(preview, input, result);
            const only = result.restored.length === 1 ? result.restored[0] : null;
            setNotice({
              tone: "success",
              text: message.text,
              details: message.details,
              action: only
                ? { label: "Open", onSelect: () => void study(only.repertoireId) }
                : undefined
            });
          }}
        />
      ) : null}
      {deleting ? (
        <DeleteRepertoireDialog
          repertoire={deleting}
          pending={remove.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => confirmDelete(deleting)}
        />
      ) : null}
    </Page>
  );
}

/** Deleting a repertoire asks first: its chapters, notes and practice history go with it. */
function DeleteRepertoireDialog({
  repertoire,
  pending,
  onCancel,
  onConfirm
}: {
  repertoire: RepertoireSummary;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      size="sm"
      title={`Delete “${repertoire.name}”?`}
      description="Its chapters, notes and practice history are deleted. Archive it instead to keep them."
      onClose={onCancel}
      footer={
        <>
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="ghost-destructive"
            size="sm"
            disabled={pending}
            onClick={onConfirm}
          >
            <Trash2 />
            Delete repertoire
          </Button>
        </>
      }
    />
  );
}
