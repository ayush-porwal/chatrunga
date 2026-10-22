import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Copy,
  Download,
  FilePlus2,
  Library,
  Pencil,
  Plus,
  Trash2,
  Upload
} from "lucide-react";
import type { BookSummary } from "@chaturanga/shared/types/books";
import type { RepertoireSummary } from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { OverflowMenu, type MenuItem } from "@/components/ui/menu";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useEventCallback } from "@/lib/use-event-callback";
import { card, pageShell } from "@/lib/ui";
import {
  useArchiveRepertoireMutation,
  useDuplicateRepertoireMutation,
  useExportRepertoireMutation,
  useRemoveChapterMutation,
  useRemoveRepertoireMutation
} from "../../queries/repertoire";
import { useBooksQuery } from "../../queries/books";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { useBookImportStore, useBookProgress } from "../books/book-imports";
import { importingBooks } from "../books/book-model";
import { BookImportDialog } from "../books/BookImportDialog";
import { BookImportRows } from "../books/BookImportRows";
import { useOpenSettings } from "../settings/settings-link";
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
import { RepertoireTable } from "./RepertoireTable";
import { useHubFilters, useHubList, useHubResume, useStudyFromHub } from "./useRepertoireHub";

const TITLE_ID = "repertoire-hub-title";

/**
 * The repertoire hub (§5.1), laid out as Play: one card of the repertoires, as a table. With no
 * repertoire at all (and no book being imported) the page shows its empty state alone, no card
 * (hub-view.ts). A row
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
  const resume = useHubResume();
  const { mutate: duplicateRepertoire } = useDuplicateRepertoireMutation();
  const { mutate: archiveRepertoire } = useArchiveRepertoireMutation();
  const remove = useRemoveRepertoireMutation();
  const exportMutation = useExportRepertoireMutation();
  const [creating, setCreating] = useState<CreateIntent | null>(null);
  const [importTarget, setImportTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<RepertoireSummary | null>(null);
  const [editing, setEditing] = useState<RepertoireSummary | null>(null);
  const [notice, setNotice] = useState<HubMessage | null>(null);
  /** The Import book dialog: a new book, or continuing one whose pages weren't all sent. */
  const [bookDialog, setBookDialog] = useState<{ book: BookSummary | null } | null>(null);
  const books = useHubBooks();
  const { list, view } = useHubList(filters, desktop, books.length);
  const openSettings = useOpenSettings();

  const fail = (error: unknown, fallback: string) =>
    setNotice({ tone: "danger", text: ipcErrorMessage(error) || fallback });

  const study = useStudyFromHub(onStudy, setNotice);

  const exportPgn = useEventCallback((item: RepertoireSummary) => {
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
  });
  const duplicate = useEventCallback((item: RepertoireSummary) =>
    duplicateRepertoire(
      { id: item.id },
      {
        onSuccess: (copy) => setNotice({ tone: "success", text: `Created “${copy.name}”.` }),
        onError: (error) => fail(error, "Couldn't duplicate it.")
      }
    )
  );
  const archive = useEventCallback((item: RepertoireSummary) =>
    archiveRepertoire(
      { id: item.id, archived: !item.archivedAt, expectedRevision: item.revision },
      { onError: (error) => fail(error, "Couldn't change it.") }
    )
  );

  /** A row's ⋯ menu: edit, import/export, duplicate, archive, delete (stable, for the rows' memo). */
  const actionsFor = useCallback(
    (item: RepertoireSummary): (MenuItem | false)[] => [
      { label: "Edit repertoire", icon: <Pencil />, onSelect: () => setEditing(item) },
      { label: "Import PGN", icon: <Upload />, onSelect: () => setImportTarget(item.id) },
      { label: "Export PGN", icon: <Download />, onSelect: () => exportPgn(item) },
      { label: "Duplicate", icon: <Copy />, divided: true, onSelect: () => duplicate(item) },
      {
        label: item.archivedAt ? "Unarchive" : "Archive",
        icon: item.archivedAt ? <ArchiveRestore /> : <Archive />,
        onSelect: () => archive(item)
      },
      {
        label: "Delete",
        icon: <Trash2 />,
        destructive: true,
        divided: true,
        onSelect: () => setDeleting(item)
      }
    ],
    [exportPgn, duplicate, archive]
  );
  const studyRow = useEventCallback((id: string) => void study(id));
  const practiceRow = useEventCallback((item: RepertoireSummary) => {
    if (resume?.repertoireId === item.id) onResume(resume);
    else onPractice(item.id);
  });

  /** The title bar's New menu: a blank repertoire, one from a PGN, or one from a book's PDF. */
  const newItems: MenuItem[] = [
    { label: "Blank repertoire", icon: <Plus />, onSelect: () => setCreating("blank") },
    { label: "Import PGN", icon: <FilePlus2 />, onSelect: () => setCreating("import") },
    {
      label: "Import book (PDF)…",
      icon: <BookOpen />,
      onSelect: () => setBookDialog({ book: null })
    }
  ];

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
        <BookReadyNotices onOpen={(repertoireId) => void study(repertoireId)} />
        {view === "card" ? (
          <section aria-labelledby={TITLE_ID} className={card}>
            <CardTitleBar
              id={TITLE_ID}
              title={filters.archived ? "Archived repertoires" : "Repertoires"}
              count={list.isSuccess && !filters.query.trim() ? list.data.length : null}
              actions={<HubTitleActions filters={filters} newItems={newItems} />}
            />
            {filters.archived ? null : (
              <BookImportRows books={books} onContinue={(book) => setBookDialog({ book })} />
            )}
            <RepertoireTable
              list={list}
              now={now}
              labelledBy={TITLE_ID}
              resume={resume}
              actionsFor={actionsFor}
              onStudy={studyRow}
              onPractice={practiceRow}
              empty={
                // Book rows above it: the books being imported are what's listed for now.
                books.length && !filters.archived ? null : (
                  <NoMatches archived={filters.archived} query={filters.query.trim()} />
                )
              }
            />
          </section>
        ) : view === "none" ? (
          <HubEmptyState desktop={desktop} newItems={newItems} />
        ) : null}
      </div>

      <HubCreateImport
        creating={creating}
        importTarget={importTarget}
        onCreatingChange={setCreating}
        onImportTargetChange={setImportTarget}
        onStudy={onStudy}
        onNotice={setNotice}
      />
      {bookDialog ? (
        <BookImportDialog
          book={bookDialog.book}
          onClose={() => setBookDialog(null)}
          onOpenSettings={() => {
            setBookDialog(null);
            openSettings?.("ai");
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
 * The books being imported (the hub's rows for them), following their progress while the hub is
 * open; a book that finished since it was last listed gets its "… is ready" notice.
 */
function useHubBooks(): BookSummary[] {
  useBookProgress();
  const list = useBooksQuery();
  useEffect(() => {
    if (list.data) useBookImportStore.getState().observe(list.data);
  }, [list.data]);
  return list.data ? importingBooks(list.data) : [];
}

/** "<title> is ready": a book that finished importing, with Open (its repertoire in Study). */
function BookReadyNotices({ onOpen }: { onOpen: (repertoireId: string) => void }) {
  const ready = useBookImportStore((state) => state.ready);
  const dismiss = (bookId: string) => useBookImportStore.getState().dismissReady(bookId);
  return ready.map((notice) => (
    <HubNotice
      key={notice.bookId}
      notice={{
        tone: "success",
        text: `“${notice.title}” is ready.`,
        action: { label: "Open", onSelect: () => onOpen(notice.repertoireId) }
      }}
      onChange={() => dismiss(notice.bookId)}
    />
  ));
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

/** The card's quiet row when its list is empty: no search match, or none archived or active. */
function NoMatches({ archived, query }: { archived: boolean; query: string }) {
  return (
    <p className="px-4 py-6 text-center text-[0.8125rem] text-fg-muted">
      {query
        ? `No repertoires match “${query}”`
        : archived
          ? "No archived repertoires"
          : "No active repertoires"}
    </p>
  );
}

/**
 * No repertoire at all: the empty state sits in the page itself (no card), centred, with the New
 * menu (blank, from a PGN, from a book); or why repertoires need the desktop app.
 */
function HubEmptyState({ desktop, newItems }: { desktop: boolean; newItems: MenuItem[] }) {
  if (!desktop) {
    return (
      <EmptyState
        className="m-auto"
        icon={<Library />}
        title="Repertoires need the desktop app"
        description="Your repertoires, practice schedule and progress are stored by the app."
      />
    );
  }
  return (
    <EmptyState
      className="m-auto"
      icon={<Library />}
      title="No repertoires yet"
      description="Start one for each side you play — for example “My 1.e4 repertoire” or “Black against 1.e4”."
      action={
        <OverflowMenu
          label="New repertoire"
          trigger={{ text: "New", icon: <Plus />, variant: "primary" }}
          items={newItems}
        />
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
