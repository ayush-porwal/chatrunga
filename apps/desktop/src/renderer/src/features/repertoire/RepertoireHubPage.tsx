import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
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
  Stethoscope,
  Trash2,
  Upload
} from "lucide-react";
import type { BookSummary } from "@chaturanga/shared/types/books";
import type { RepertoireSummary } from "@chaturanga/shared/types/repertoire";
import type { RepertoireHubTab } from "@chaturanga/shared/types/repertoire-practice";
import { tabPanelProps } from "@/components/ui/segmented-control";
import { ChipButton } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { OverflowMenu, type MenuItem } from "@/components/ui/menu";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useEventCallback } from "@/lib/use-event-callback";
import { card, pageShell } from "@/lib/ui";
import { cn } from "@/lib/utils";
import {
  useArchiveRepertoireMutation,
  useDuplicateRepertoireMutation,
  useExportRepertoireMutation,
  useRemoveRepertoireMutation,
  useRepertoireDueSummaryQuery,
  useRepertoiresQuery
} from "../../queries/repertoire";
import { useBooksQuery } from "../../queries/books";
import { usePracticeOverviewQuery } from "../../queries/repertoire-practice";
import { useRepertoireHealthQueueMutation } from "../../queries/repertoire-health";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { useBookImportStore, useBookProgress } from "../books/book-imports";
import { importingBooks } from "../books/book-model";
import { BookImportDialog } from "../books/BookImportDialog";
import { BookImportRows } from "../books/BookImportRows";
import { useOpenSettings } from "../settings/settings-link";
import { WorkspaceTabBar } from "../board/WorkspaceTabBar";
import { RecentGamesSearch } from "../play/recent-games-controls";
import { CreateRepertoireDialog } from "./CreateRepertoireDialog";
import { EditRepertoireDialog } from "./EditRepertoireDialog";
import { HubNotice, type HubMessage } from "./HubNotice";
import { ImportPgnDialog } from "./ImportPgnDialog";
import { createScrollRestore } from "./hub-scroll";
import { HubActionsSlot, HubTabActions } from "./hub-tab-actions";
import { REPERTOIRE_HUB_PANEL_ID, useRepertoireHubTab } from "./hub-tabs";
import type { InsightsReviewTarget, WeakSpotsTarget } from "./insights/insights-actions";
import { PracticeTilesLoading } from "./practice/practice-tiles";
import { weakSpotsPreset, type PracticePreset } from "./practice-setup";
import {
  plural,
  sortedChapters,
  type ResumePracticeTarget,
  type StudyOpenTarget,
  type StudyTarget
} from "./repertoire-chapters";
import {
  RepertoireTable,
  RepertoireTableSkeleton,
  type HubChapterActions
} from "./RepertoireTable";

const PracticeTab = lazy(() =>
  import("./practice/PracticeTab").then((module) => ({ default: module.PracticeTab }))
);
const InsightsTab = lazy(() =>
  import("./insights/InsightsTab").then((module) => ({ default: module.InsightsTab }))
);
import { useHubFilters, useHubList, useHubResume, useStudyFromHub } from "./useRepertoireHub";

/** The Repertoires tab's id: it names the table. */
const REPERTOIRES_TAB_ID = `${REPERTOIRE_HUB_PANEL_ID}-tab-repertoires`;
const ACTIVE_LIST = {};
const ARCHIVED_LIST = { archived: true };

/**
 * The Repertoires tab (§5.1): the repertoires as a table, laid out as Play's Recent games. With no
 * repertoire at all (and no book being imported) the tab shows its empty state alone, no table
 * (hub-view.ts). A row opens Study at the chapter last studied; Practice starts a session (due
 * positions first, then new ones) or resumes the unfinished one; the ⋯ menu edits, imports and
 * exports, duplicates, archives and deletes. The tab bar's tools search, show the archived ones
 * instead (only when there are some), and start a new repertoire (blank, from a PGN or a book).
 * Backups live in Settings.
 */
function RepertoiresTab({
  onStudy,
  onPractice,
  onPracticePreset,
  onResume
}: Omit<HubPageProps, "onReviewGame">) {
  const desktop = Boolean(window.chaturanga?.repertoires);
  const filters = useHubFilters();
  // "Last studied" is relative to when the hub opened (render stays pure).
  const [now] = useState(() => Date.now());
  const resume = useHubResume();
  const { mutate: duplicateRepertoire } = useDuplicateRepertoireMutation();
  const { mutate: archiveRepertoire } = useArchiveRepertoireMutation();
  const remove = useRemoveRepertoireMutation();
  const exportMutation = useExportRepertoireMutation();
  const [creating, setCreating] = useState(false);
  /** Import PGN: into a repertoire, or (null) into a new one the import creates. */
  const [importTarget, setImportTarget] = useState<{ repertoireId: string | null } | null>(null);
  const [deleting, setDeleting] = useState<RepertoireSummary | null>(null);
  const [editing, setEditing] = useState<RepertoireSummary | null>(null);
  const [notice, setNotice] = useState<HubMessage | null>(null);
  /** The Import book dialog: a new book, or continuing one whose pages weren't all sent. */
  const [bookDialog, setBookDialog] = useState<{ book: BookSummary | null } | null>(null);
  const books = useHubBooks();
  const { list, view } = useHubList(filters, desktop, books.length);
  const archivedList = useRepertoiresQuery(ARCHIVED_LIST, { enabled: desktop });
  const openSettings = useOpenSettings();
  const overview = usePracticeOverviewQuery({ enabled: desktop });
  const stats = useMemo(
    () => new Map(overview.data?.repertoires.map((item) => [item.repertoireId, item])),
    [overview.data]
  );
  const chapterActions = useMemo<HubChapterActions>(
    () => ({
      onStudyChapter: (repertoireId, chapterId) =>
        onStudy({ repertoireId, chapterId, nodeId: null }),
      onPractiseChapter: (repertoireId, chapterId) =>
        onPracticePreset(repertoireId, { chapterIds: [chapterId] })
    }),
    [onStudy, onPracticePreset]
  );

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
  // The health check (§6.3): its results show in Study and on the Insights tab.
  const { mutate: queueHealth } = useRepertoireHealthQueueMutation();
  const checkHealth = useEventCallback((item: RepertoireSummary) =>
    queueHealth(
      { action: "check", repertoireIds: [item.id] },
      {
        onSuccess: () =>
          setNotice({
            tone: "info",
            text: `Checking “${item.name}”. Its flags show in Study and on the Insights tab.`
          }),
        onError: (error) => fail(error, "Couldn't start the health check.")
      }
    )
  );

  /** A row's ⋯ menu: edit, import/export, duplicate, archive, delete (stable, for the rows' memo). */
  const actionsFor = useCallback(
    (item: RepertoireSummary): (MenuItem | false)[] => [
      { label: "Edit repertoire", icon: <Pencil />, onSelect: () => setEditing(item) },
      {
        label: "Import PGN",
        icon: <Upload />,
        onSelect: () => setImportTarget({ repertoireId: item.id })
      },
      { label: "Export PGN", icon: <Download />, onSelect: () => exportPgn(item) },
      !item.archivedAt && {
        label: "Run check",
        icon: <Stethoscope />,
        onSelect: () => checkHealth(item)
      },
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
    [exportPgn, duplicate, archive, checkHealth]
  );
  const studyRow = useEventCallback((id: string) => void study(id));
  const practiceRow = useEventCallback((item: RepertoireSummary) => {
    if (resume?.repertoireId === item.id) onResume(resume);
    else onPractice(item.id);
  });

  /** The title bar's New menu: a blank repertoire, one from a PGN, or one from a book's PDF. */
  const newItems: MenuItem[] = [
    { label: "Blank repertoire", icon: <Plus />, onSelect: () => setCreating(true) },
    {
      label: "Import PGN",
      icon: <FilePlus2 />,
      onSelect: () => setImportTarget({ repertoireId: null })
    },
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
    <>
      {view === "none" ? null : (
        <HubTabActions>
          <HubTitleActions
            filters={filters}
            newItems={newItems}
            archivedToggle={filters.archived || Boolean(archivedList.data?.length)}
          />
        </HubTabActions>
      )}
      <div className="grid gap-2 p-3 empty:hidden">
        {notice ? <HubNotice notice={notice} onChange={setNotice} /> : null}
        <BookReadyNotices onOpen={(repertoireId) => void study(repertoireId)} />
      </div>
      {view === "card" ? (
        <>
          {filters.archived ? null : (
            <BookImportRows books={books} onContinue={(book) => setBookDialog({ book })} />
          )}
          <RepertoireTable
            list={list}
            now={now}
            labelledBy={REPERTOIRES_TAB_ID}
            resume={resume}
            stats={stats}
            actionsFor={actionsFor}
            onStudy={studyRow}
            onPractice={practiceRow}
            chapters={chapterActions}
            empty={
              // Book rows above it: the books being imported are what's listed for now.
              books.length && !filters.archived ? null : (
                <NoMatches archived={filters.archived} query={filters.query.trim()} />
              )
            }
          />
        </>
      ) : view === "none" ? (
        <div className="grid py-16">
          <HubEmptyState desktop={desktop} newItems={newItems} />
        </div>
      ) : null}

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
    </>
  );
}

type HubPageProps = {
  onStudy: (target: StudyOpenTarget) => void;
  /** Practice: a session starts at once with the repertoire's practice settings. */
  onPractice: (repertoireId: string) => void;
  /** A session from a preset (a chapter, a Practice tab set, weak spots), started at once. */
  onPracticePreset: (repertoireId: string, preset: PracticePreset) => void;
  /** The unfinished practice session (e.g. after a restart). */
  onResume: (target: ResumePracticeTarget) => void;
  /** Insights → Game review at a move. */
  onReviewGame: (target: InsightsReviewTarget) => void;
};

/** Where each tab was scrolled to, so coming back to the hub (Back) returns there. */
const tabScroll = new Map<RepertoireHubTab, number>();

/**
 * Repertoire (docs/repertoire-games-and-practice.md §1): one card whose title bar holds the tabs
 * Repertoires (the library, with how many), Practice (sets and progress, with the due count) and
 * Insights (your games), and at its right end the shown tab's own actions. The window's title bar
 * stays the page's title. The card always fills the page: switching tabs changes only what the
 * panel under the tab bar shows, and the panel scrolls (each tab's position kept for when the hub
 * comes back).
 */
export function RepertoireHubPage(props: HubPageProps) {
  const { onStudy, onPracticePreset, onReviewGame } = props;
  const [tab, setTab] = useRepertoireHubTab();
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const desktop = Boolean(window.chaturanga?.repertoires);
  const active = useRepertoiresQuery(ACTIVE_LIST, { enabled: desktop }).data?.length ?? 0;
  const due = useRepertoireDueSummaryQuery().data?.dueCount ?? 0;
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = scroller.current;
    const content = element?.firstElementChild;
    if (!element || !content) return;
    // The tab's content may still be loading: its position comes back once it is tall enough.
    const restore = createScrollRestore(tabScroll.get(tab) ?? 0);
    restore.restore(element);
    const observer = new ResizeObserver(() => restore.restore(element));
    observer.observe(content);
    const remember = () => {
      const top = restore.scrolled(element);
      if (top !== null) tabScroll.set(tab, top);
    };
    element.addEventListener("scroll", remember, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", remember);
    };
  }, [tab]);
  /** Weak spots over every active repertoire (or one row's position); back leads to this tab. */
  const practiseWeakSpots = useEventCallback((target: WeakSpotsTarget, repertoireIds: string[]) => {
    const first = target?.repertoireId ?? repertoireIds[0];
    if (first) onPracticePreset(first, weakSpotsPreset(target, repertoireIds, tab));
  });
  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <h1 className="sr-only">Repertoire</h1>
      <section aria-label="Repertoire" className={cn(card, "flex min-h-0 flex-1 flex-col")}>
        <WorkspaceTabBar<RepertoireHubTab>
          panelId={REPERTOIRE_HUB_PANEL_ID}
          ariaLabel="Repertoire"
          tabs={[
            { value: "repertoires", label: "Repertoires", count: active },
            { value: "practice", label: "Practice", count: due },
            { value: "insights", label: "Insights" }
          ]}
          value={tab}
          onChange={setTab}
          actions={<span ref={setActionsSlot} className="contents" />}
        />
        <div
          ref={scroller}
          {...tabPanelProps(REPERTOIRE_HUB_PANEL_ID, tab)}
          className={cn(pageShell, "h-auto min-h-0 flex-1 rounded-b-[11px]")}
        >
          {/* The tab's content: its height is what the scroll restore waits on. */}
          <div className="flex min-h-full min-w-0 flex-col">
            <HubActionsSlot.Provider value={actionsSlot}>
              <Suspense
                fallback={
                  tab === "practice" ? (
                    <PracticeTilesLoading />
                  ) : (
                    <RepertoireTableSkeleton label="Loading" />
                  )
                }
              >
                {tab === "repertoires" ? (
                  <RepertoiresTab {...props} />
                ) : tab === "practice" ? (
                  <PracticeTab
                    onPracticePreset={onPracticePreset}
                    onPractiseWeakSpots={practiseWeakSpots}
                    onSeeReport={() => setTab("insights")}
                  />
                ) : (
                  <InsightsTabWithSets
                    onStudy={onStudy}
                    onReviewGame={onReviewGame}
                    onPractiseWeakSpots={practiseWeakSpots}
                  />
                )}
              </Suspense>
            </HubActionsSlot.Provider>
          </div>
        </div>
      </section>
    </div>
  );
}

/** Insights, its weak-spots practice over every active repertoire (or the one a row names). */
function InsightsTabWithSets({
  onStudy,
  onReviewGame,
  onPractiseWeakSpots
}: {
  onStudy: (target: StudyOpenTarget) => void;
  onReviewGame: (target: InsightsReviewTarget) => void;
  onPractiseWeakSpots: (target: WeakSpotsTarget, repertoireIds: string[]) => void;
}) {
  const overview = usePracticeOverviewQuery();
  const ids = overview.data?.repertoires.map((item) => item.repertoireId) ?? [];
  return (
    <InsightsTab
      onStudy={onStudy}
      onReviewGame={onReviewGame}
      onPractiseWeakSpots={(target) => onPractiseWeakSpots(target, ids)}
      // Every repertoire's weak spots need their list (the route names the first one).
      weakSpotsReady={ids.length > 0}
    />
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

/**
 * The Repertoires tab's tools: search, Archived (the archived ones instead of the active; only when
 * there are some, or while it is on), and New (last).
 */
function HubTitleActions({
  filters,
  newItems,
  archivedToggle
}: {
  filters: ReturnType<typeof useHubFilters>;
  newItems: MenuItem[];
  archivedToggle: boolean;
}) {
  return (
    <>
      <RecentGamesSearch
        query={filters.query}
        onQueryChange={filters.setQuery}
        label="Search repertoires"
      />
      {archivedToggle ? (
        <ChipButton
          selected={filters.archived}
          onClick={() => filters.setArchived(!filters.archived)}
        >
          <Archive />
          Archived
        </ChipButton>
      ) : null}
      <OverflowMenu
        label="New repertoire"
        trigger={{ text: "New", icon: <Plus />, variant: "primary", compact: true }}
        items={newItems}
      />
    </>
  );
}

/**
 * New repertoire, and Import PGN: into a repertoire, or into a new one the import creates (named
 * and coloured from the PGN in its preview).
 */
function HubCreateImport({
  creating,
  importTarget,
  onCreatingChange,
  onImportTargetChange,
  onStudy,
  onNotice
}: {
  creating: boolean;
  importTarget: { repertoireId: string | null } | null;
  onCreatingChange: (creating: boolean) => void;
  onImportTargetChange: (target: { repertoireId: string | null } | null) => void;
  onStudy: (target: StudyTarget) => void;
  onNotice: (notice: HubMessage) => void;
}) {
  return (
    <>
      {creating ? (
        <CreateRepertoireDialog
          onClose={() => onCreatingChange(false)}
          onCreated={(detail, next) => {
            onCreatingChange(false);
            const first = sortedChapters(detail.chapters).at(0);
            if (next === "study" && first) {
              onStudy({ repertoireId: detail.id, chapterId: first.id, nodeId: null });
            }
            // "add-game": the Add to repertoire dialog is open over the hub.
          }}
        />
      ) : null}
      {importTarget ? (
        <ImportPgnDialog
          repertoireId={importTarget.repertoireId}
          onClose={() => onImportTargetChange(null)}
          onImported={(result) => {
            onImportTargetChange(null);
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
