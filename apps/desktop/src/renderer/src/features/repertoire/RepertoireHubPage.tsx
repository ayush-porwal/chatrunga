import { useState, type ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  Copy,
  Download,
  FilePlus2,
  Library,
  Pencil,
  Plus,
  Trash2,
  Upload
} from "lucide-react";
import type { RepertoireSummary } from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { OverflowMenu, type MenuItem } from "@/components/ui/menu";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { pageShell } from "@/lib/ui";
import { cn } from "@/lib/utils";
import {
  useArchiveRepertoireMutation,
  useDuplicateRepertoireMutation,
  useExportRepertoireMutation,
  useRemoveChapterMutation,
  useRemoveRepertoireMutation,
  useRepertoiresQuery
} from "../../queries/repertoire";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { CardTitleBar } from "../play/card-title";
import { RecentGamesSearch } from "../play/recent-games-controls";
import { CreateRepertoireDialog, type CreateIntent } from "./CreateRepertoireDialog";
import { EditRepertoireDialog } from "./EditRepertoireDialog";
import { HubNotice, type HubMessage } from "./HubNotice";
import { ImportPgnDialog } from "./ImportPgnDialog";
import {
  plural,
  sortedChapters,
  type ResumePracticeTarget,
  type StudyTarget
} from "./repertoire-chapters";
import { RepertoireTable, type RowPractice } from "./RepertoireTable";
import { useHubFilters, useHubResume, useStudyFromHub } from "./useRepertoireHub";

const TITLE_ID = "repertoire-hub-title";

/**
 * The repertoire hub (§5.1), laid out as Play: one card of the repertoires, as a table. A row
 * opens Study at the chapter last studied; Practice starts a session (due positions first, then
 * new ones) or resumes the unfinished one; the ⋯ menu edits, imports and exports, duplicates,
 * archives and deletes. The title bar searches, shows the archived ones instead, and starts a new
 * repertoire (blank, or from a PGN). Backups live in Settings.
 */
export function RepertoireHubPage({
  onStudy,
  onPractice,
  onResume
}: {
  onStudy: (target: StudyTarget) => void;
  /** Practice: a session starts at once with the repertoire's practice settings. */
  onPractice: (repertoireId: string) => void;
  /** The unfinished practice session (e.g. after a restart). */
  onResume: (target: ResumePracticeTarget) => void;
}) {
  const desktop = Boolean(window.chaturanga?.repertoires);
  const filters = useHubFilters();
  // "Last studied" is relative to when the hub opened (render stays pure).
  const [now] = useState(() => Date.now());
  const list = useRepertoiresQuery(filters.listFilters);
  const resume = useHubResume();
  const duplicate = useDuplicateRepertoireMutation();
  const archive = useArchiveRepertoireMutation();
  const remove = useRemoveRepertoireMutation();
  const exportMutation = useExportRepertoireMutation();
  const [creating, setCreating] = useState<CreateIntent | null>(null);
  const [importTarget, setImportTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<RepertoireSummary | null>(null);
  const [editing, setEditing] = useState<RepertoireSummary | null>(null);
  const [notice, setNotice] = useState<HubMessage | null>(null);

  const fail = (error: unknown, fallback: string) =>
    setNotice({ tone: "danger", text: ipcErrorMessage(error) || fallback });

  const study = useStudyFromHub(onStudy, setNotice);

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

  /** A row's ⋯ menu: edit, import/export, duplicate, archive, delete. */
  function actionsFor(item: RepertoireSummary): (MenuItem | false)[] {
    return [
      { label: "Edit repertoire", icon: <Pencil />, onSelect: () => setEditing(item) },
      { label: "Import PGN", icon: <Upload />, onSelect: () => setImportTarget(item.id) },
      { label: "Export PGN", icon: <Download />, onSelect: () => exportPgn(item) },
      {
        label: "Duplicate",
        icon: <Copy />,
        divided: true,
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
            { id: item.id, archived: !item.archivedAt, expectedRevision: item.revision },
            { onError: (error) => fail(error, "Couldn't change it.") }
          )
      },
      {
        label: "Delete",
        icon: <Trash2 />,
        destructive: true,
        divided: true,
        onSelect: () => setDeleting(item)
      }
    ];
  }

  /** The title bar's New menu: a blank repertoire, or one from a PGN. */
  const newItems: MenuItem[] = [
    { label: "Blank repertoire", icon: <Plus />, onSelect: () => setCreating("blank") },
    { label: "Import PGN", icon: <FilePlus2 />, onSelect: () => setCreating("import") }
  ];

  const practiceFor = (item: RepertoireSummary): RowPractice =>
    resume?.repertoireId === item.id
      ? { kind: "resume", description: resume.description }
      : { kind: "practice" };

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

  return (
    <div className={pageShell}>
      <div className="flex min-h-full flex-col gap-4 p-6">
        <h1 className="sr-only">Repertoire</h1>
        {notice ? <HubNotice notice={notice} onChange={setNotice} /> : null}
        <RepertoiresCard desktop={desktop} filters={filters} list={list} actions={newItems}>
          <RepertoireTable
            list={list}
            now={now}
            labelledBy={TITLE_ID}
            practiceFor={practiceFor}
            actionsFor={actionsFor}
            onStudy={(id) => void study(id)}
            onPractice={(item) => {
              if (resume?.repertoireId === item.id) onResume(resume);
              else onPractice(item.id);
            }}
            empty={
              <HubEmptyState
                archived={filters.archived}
                query={filters.query.trim()}
                onCreate={() => setCreating("blank")}
              />
            }
          />
        </RepertoiresCard>
      </div>

      <HubCreateImport
        creating={creating}
        importTarget={importTarget}
        onCreatingChange={setCreating}
        onImportTargetChange={setImportTarget}
        onStudy={onStudy}
        onNotice={setNotice}
      />
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
      {deleting ? (
        <DeleteRepertoireDialog
          repertoire={deleting}
          pending={remove.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => confirmDelete(deleting)}
        />
      ) : null}
    </div>
  );
}

/**
 * The hub's one card (as Play's Recent games): the title bar with the count and its tools, then
 * `children` (the table), or why repertoires need the desktop app. An empty, unfiltered list
 * stretches it down the page.
 */
function RepertoiresCard({
  desktop,
  filters,
  list,
  actions,
  children
}: {
  desktop: boolean;
  filters: ReturnType<typeof useHubFilters>;
  list: ReturnType<typeof useRepertoiresQuery>;
  /** The New menu's items. */
  actions: MenuItem[];
  children: ReactNode;
}) {
  const shown = list.data?.length ?? 0;
  const searching = Boolean(filters.query.trim());
  const fill = !desktop || (list.isSuccess && !shown && !filters.archived && !searching);
  return (
    <section
      aria-labelledby={TITLE_ID}
      className={cn(
        "min-w-0 rounded-xl border border-line bg-surface",
        fill ? "flex flex-1 flex-col" : null
      )}
    >
      <CardTitleBar
        id={TITLE_ID}
        title={filters.archived ? "Archived repertoires" : "Repertoires"}
        count={list.isSuccess && !searching ? shown : null}
        actions={desktop ? <HubTitleActions filters={filters} newItems={actions} /> : null}
      />
      {desktop ? (
        children
      ) : (
        <EmptyState
          className="m-auto"
          icon={<Library />}
          title="Repertoires need the desktop app"
          description="Your repertoires, practice schedule and progress are stored by the app."
        />
      )}
    </section>
  );
}

/** The card title bar's tools: search, archived instead of active ones, and New (last). */
function HubTitleActions({
  filters,
  newItems
}: {
  filters: ReturnType<typeof useHubFilters>;
  newItems: MenuItem[];
}) {
  return (
    <>
      <RecentGamesSearch
        query={filters.query}
        onQueryChange={filters.setQuery}
        label="Search repertoires"
      />
      <IconButton
        label={filters.archived ? "Show active repertoires" : "Show archived"}
        icon={<Archive />}
        aria-pressed={filters.archived}
        className={filters.archived ? "bg-control text-fg" : undefined}
        onClick={() => filters.setArchived(!filters.archived)}
      />
      <OverflowMenu
        label="New repertoire"
        trigger={{ text: "New", icon: <Plus />, variant: "primary", compact: true }}
        items={newItems}
      />
    </>
  );
}

/**
 * New repertoire (blank, or from a PGN) and Import PGN: a repertoire created to import into has an
 * empty first chapter, which the import replaces.
 */
function HubCreateImport({
  creating,
  importTarget,
  onCreatingChange,
  onImportTargetChange,
  onStudy,
  onNotice
}: {
  creating: CreateIntent | null;
  importTarget: string | null;
  onCreatingChange: (intent: CreateIntent | null) => void;
  onImportTargetChange: (repertoireId: string | null) => void;
  onStudy: (target: StudyTarget) => void;
  onNotice: (notice: HubMessage) => void;
}) {
  const removeChapter = useRemoveChapterMutation();
  /** The empty first chapter of a repertoire created to import into; the import replaces it. */
  const [placeholder, setPlaceholder] = useState<{
    repertoireId: string;
    chapterId: string;
  } | null>(null);
  return (
    <>
      {creating ? (
        <CreateRepertoireDialog
          intent={creating}
          onClose={() => onCreatingChange(null)}
          onCreated={(detail, next) => {
            onCreatingChange(null);
            const first = sortedChapters(detail.chapters).at(0);
            if (next === "import") {
              onImportTargetChange(detail.id);
              setPlaceholder(first ? { repertoireId: detail.id, chapterId: first.id } : null);
            } else if (next === "study" && first) {
              onStudy({ repertoireId: detail.id, chapterId: first.id, nodeId: null });
            }
            // "add-game": the Add to repertoire dialog is open over the hub.
          }}
        />
      ) : null}
      {importTarget ? (
        <ImportPgnDialog
          repertoireId={importTarget}
          onClose={() => {
            onImportTargetChange(null);
            setPlaceholder(null);
          }}
          onImported={(result) => {
            onImportTargetChange(null);
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
            onNotice({
              tone: "success",
              text: `Imported ${plural(result.chaptersAdded, "chapter")} into “${result.repertoire.name}”.`
            });
          }}
        />
      ) : null}
    </>
  );
}

/** No repertoire listed: none matches the search, none is archived, or none exists yet. */
function HubEmptyState({
  archived,
  query,
  onCreate
}: {
  archived: boolean;
  query: string;
  onCreate: () => void;
}) {
  if (query) {
    return (
      <p className="px-4 py-6 text-center text-[0.8125rem] text-fg-muted">
        No repertoires match “{query}”
      </p>
    );
  }
  if (archived) {
    return (
      <p className="px-4 py-6 text-center text-[0.8125rem] text-fg-muted">
        No archived repertoires
      </p>
    );
  }
  return (
    <EmptyState
      className="m-auto"
      icon={<Library />}
      title="No repertoires yet"
      description="Start one for each side you play — for example “My 1.e4 repertoire” or “Black against 1.e4”."
      action={
        <Button type="button" variant="primary" onClick={onCreate}>
          <Plus />
          Create repertoire
        </Button>
      }
    />
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
