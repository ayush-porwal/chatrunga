import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { CircleAlert, GraduationCap, Loader2, Redo2, Settings, Undo2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { promotionTarget } from "@chaturanga/shared/chess/move-tree-promote";
import type { ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import type { BookPages } from "@chaturanga/shared/types/books";
import type { RepertoireHealthFlag } from "@chaturanga/shared/types/repertoire-health";
import type { Color, MoveNode } from "@chaturanga/shared/types/chess";
import type {
  RepertoireChapterSummary,
  RepertoireDecision,
  RepertoireDetail
} from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { tabPanelProps } from "@/components/ui/segmented-control";
import { isElectronMac } from "@/lib/environment";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useBookPagesQuery } from "../../queries/books";
import {
  useExportRepertoireMutation,
  useRepertoireChapterQuery,
  useRepertoireQuery
} from "../../queries/repertoire";
import { useRepertoireHealthFlags } from "../../queries/repertoire-health";
import { useAppNoticeStore } from "../../stores/app-notice-store";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { useStudyEngineStore } from "../../stores/study-engine-store";
import { selectLiveGameInProgress, useLichessStore } from "../../stores/lichess-store";
import { DESTINATION_ICONS } from "../../app/destination-icons";
import { BoardWorkspace } from "../board/BoardWorkspace";
import { BookChapterReport } from "../books/BookChapterReport";
import { bookPageAt, bookPageLabel, chapterFirstPage, shownBookPage } from "../books/book-model";
import { StudyBookTab } from "../books/StudyBookTab";
import type { BookPageLinks } from "../game/TreeView";
import { WorkspaceTabBar, type WorkspaceTab } from "../board/WorkspaceTabBar";
import { nextSortOrder, plural, sortedChapters, type StudyStage } from "./repertoire-chapters";
import { moveKinds, type MoveKind } from "./repertoire-model";
import { RepertoireMoveNavigation } from "./RepertoireMoveNavigation";
import { RepertoireSettingsDialog } from "./RepertoireSettingsDialog";
import { StudyBoardStage } from "./StudyBoardStage";
import { StudyChaptersPanel } from "./StudyChaptersPanel";
import {
  ChoiceMoveMenu,
  StudyChoicesPanel,
  useMoveFlags,
  useRepertoireArrows,
  useStudyChoices
} from "./StudyChoicesPanel";
import { StudyExplorerTab } from "./StudyExplorerTab";
import { StudyLineStrip } from "./StudyLineStrip";
import { StudyMoveMenu, usePausedAt } from "./StudyMoveMenu";
import { StudyCommentDialog, StudyDecisionDialog } from "./StudyNoteDialogs";
import {
  ChapterSaveNotice,
  DeletedLineNotice,
  FailedDecisionNotices,
  LoadErrorNotice,
  StudyErrorNotice
} from "./StudyNotices";
import { StudyPracticeFooter } from "./StudyPracticeFooter";
import { StudySourcesSection } from "./StudySourcesSection";
import { StudyMovesTab } from "./StudyMovesTab";
import { StudyStagingNotices } from "./StudyStagingNotices";
import { useChapterAutosave } from "./useChapterAutosave";
import { useChapterDraftLoad } from "./useChapterDraftLoad";
import { studyEditShortcutLabels } from "./study-edit-shortcuts";
import type { StudyFromGames } from "./study-from-games";
import { useDecisionDraftCommands } from "./useDecisionDraftCommands";
import { useIncludeInPractice } from "./useIncludeInPractice";
import { useMissingChapterHandoff } from "./useMissingChapterHandoff";
import { useMoveTreeEditing } from "./useMoveTreeEditing";
import { useStudyCommands } from "./useStudyCommands";
import { useStudyPosition } from "./useStudyPosition";
import { useStudyTraining } from "./useStudyTraining";

export type StudyTab = "moves" | "chapters" | "explorer" | "book";

/**
 * The panel's tabs, in order: Moves, Chapters, Explorer, and Book for a repertoire imported from
 * a book.
 */
function studyTabs(chapterCount: number, book: boolean): WorkspaceTab<StudyTab>[] {
  return [
    { value: "moves", label: "Moves" },
    { value: "chapters", label: "Chapters", count: chapterCount },
    { value: "explorer", label: "Explorer" },
    ...(book ? [{ value: "book" as const, label: "Book" }] : [])
  ];
}

const workspace = () => useRepertoireWorkspaceStore.getState();
const NO_STAGED: MoveNode[] = [];
const ExportIcon = DESTINATION_ICONS.exportPgn;

/**
 * Repertoire study (design §5.2), laid out as Analysis: the chapter on a store-free board (both
 * sides playable while authoring; drawing on) and the panel's title-bar tabs, Moves (the engine
 * when Analyze is on, then the tree with its comments; the selected move's actions in one menu)
 * and Chapters (with the open chapter's linked games), and Book for a repertoire imported from
 * a book (the selected move's page; its moves' comments carry a chip for the page each starts,
 * which opens it). Edits go to the workspace draft and
 * autosave against the repertoire revision; nothing passes through the game store. A chapter or
 * repertoire that no longer exists hands back to the hub (`onMissing`); any other failure to read
 * them keeps the page (and the draft) with the cause and Retry. The footer steps through the
 * moves and starts Practice.
 *
 * The overhaul (docs/repertoire-games-and-practice.md §3): the line strip in the summary, the
 * choices panel above the tree, the repertoire's arrows on the board, and the Explorer tab. A move
 * the chapter doesn't have (the board, an engine line, the explorer, another screen) is staged:
 * the New moves card adds it as one undoable edit. Opened from Insights, the From your games
 * banner says what the user's games did here.
 */
export function RepertoireStudyPage({
  repertoireId,
  chapterId,
  initialNodeId,
  initialOrientation,
  tab,
  stage,
  onStageApplied,
  fromGames,
  onPractisePosition,
  onOpenFlag,
  onTabChange,
  onOpenChapter,
  onAddToChapter,
  onPractice,
  onMissing,
  onHub,
  onPositionChanged,
  onOpenGame,
  onOpenEngineSettings
}: {
  repertoireId: string;
  chapterId: string;
  initialNodeId: string | null;
  initialOrientation: Color | null;
  tab: StudyTab;
  /** A move to add (or select) once the chapter loads, from a game's opening comparison. */
  stage?: StudyStage | null;
  /** The stage was applied (or couldn't be): App forgets it, so it never applies twice. */
  onStageApplied?: () => void;
  /** What the user's games did at the position, from Insights (the From your games banner). */
  fromGames?: StudyFromGames | null;
  /** Practises one position now (the banner's Practice this position). */
  onPractisePosition?: (positionKey: string) => void;
  /** Opens a health flag's position (the Explorer's flags elsewhere), with its banner. */
  onOpenFlag?: (flag: RepertoireHealthFlag) => void;
  onTabChange: (tab: StudyTab) => void;
  /** Opens a chapter (at a node: a transposition elsewhere); the open draft is saved first. */
  onOpenChapter: (chapterId: string, nodeId?: string | null) => void;
  /**
   * Opens another chapter for "Add to…" (the staged moves go along, so no leave question): true
   * once it opened, false when it didn't (a failed save, a newer navigation, a Lichess game).
   */
  onAddToChapter: (chapterId: string) => Promise<boolean>;
  /** Practice with the repertoire's settings (a rehearsal of lines plays this chapter). */
  onPractice: () => void;
  onMissing: (message: string) => void;
  /** Back to the repertoire hub (offered when the chapter couldn't be read). */
  onHub?: () => void;
  /** The selected node, tab or orientation changed (the current history entry follows). */
  onPositionChanged: () => void;
  /** A source link's saved game, opened on the board at the linked move. */
  onOpenGame?: (gameId: string, nodeId: string | null) => void;
  /** Settings' engines, offered by the engine panel (Analyze) when no engine is installed. */
  onOpenEngineSettings?: () => void;
}) {
  const panelId = useId();
  const desktop = Boolean(window.chaturanga?.repertoires);
  const detail = useRepertoireQuery(repertoireId);
  const chapterQuery = useRepertoireChapterQuery(repertoireId, chapterId);
  useChapterAutosave();
  const commands = useStudyCommands(repertoireId);
  const { draft, staged, selectedNodeId, orientation, color, loadedId } =
    useRepertoireWorkspaceStore(
      useShallow((state) => {
        const loaded = state.repertoireId === repertoireId && state.chapterId === chapterId;
        return {
          draft: loaded ? state.chapter : null,
          staged: loaded ? state.staged : NO_STAGED,
          selectedNodeId: state.selectedNodeId,
          orientation: state.orientation,
          color: state.color,
          loadedId: loaded ? state.chapterId : null
        };
      })
    );
  const [localError, setLocalError] = useState<string | null>(null);
  /** The dialog open: the selected move's comment or practice texts, or the settings. */
  const [dialog, setDialog] = useState<StudyDialog | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // The engine panel (the titlebar's Analyze) is open for this chapter only: another chapter, or
  // leaving Study, closes it, which stops its search.
  const engineOpen = useStudyEngineStore((state) => state.chapterId === chapterId);
  // Keyed on the chapter: its cleanup runs on a chapter change as well as on leaving Study.
  useEffect(() => () => useStudyEngineStore.getState().close(), [chapterId]);
  // The engine panel is atop the Moves tab: turning Analyze on (the titlebar's, from any tab)
  // shows that tab, so it never opens unseen.
  useEffect(
    () =>
      useStudyEngineStore.subscribe((state, previous) => {
        const opened = state.chapterId === chapterId && previous.chapterId !== chapterId;
        if (opened && tab !== "moves") onTabChange("moves");
      }),
    [chapterId, tab, onTabChange]
  );

  useChapterDraftLoad({
    repertoireId,
    chapterId,
    detail,
    chapterQuery,
    loadedId,
    initialNodeId,
    initialOrientation,
    stage,
    onStageApplied,
    onStageFailed: setLocalError
  });
  const { loadError, retryLoad, removeChapter } = useMissingChapterHandoff({
    chapterId,
    detail,
    chapterQuery,
    removeChapter: commands.removeChapter,
    onOpenChapter,
    onMissing
  });

  useEffect(() => {
    if (draft) onPositionChanged();
  }, [draft, selectedNodeId, tab, orientation, onPositionChanged]);

  const {
    shown,
    lookup,
    draftLookup,
    node,
    positionKey,
    decision,
    otherOccurrences,
    canEditDecision
  } = useStudyPosition({ repertoireId, chapterId, chapter: draft, staged, selectedNodeId, color });
  const blocker = useStudyTraining({ chapter: draft, lookup: draftLookup, color });
  const include = useIncludeInPractice({ repertoireId, chapterId, color, setError: setLocalError });
  const { selectNode, deletion, promoteVariation, canPromote } = useMoveTreeEditing({
    chapter: shown,
    lookup,
    selectedNodeId
  });
  const kinds = useMemo(
    () => (shown && lookup ? moveKinds(shown, lookup, color) : new Map<string, MoveKind>()),
    [shown, lookup, color]
  );
  const stagedIds = useMemo(() => new Set(staged.map((item) => item.id)), [staged]);
  const paused = usePausedAt(repertoireId, positionKey, decision?.paused ?? false);
  const flags = useRepertoireHealthFlags(repertoireId);
  const moveFlags = useMoveFlags(lookup, flags);
  // Leaving Study drops what is still staged (leaving asked first; see confirmLeavingStaged), and
  // moves handed to a chapter that never loaded. A Lichess game in progress took the screen
  // instead (its guard blocked where the user was going): the staged moves stay for the chapter.
  useEffect(
    () => () => {
      if (!selectLiveGameInProgress(useLichessStore.getState())) workspace().discardStaged();
      workspace().dropPendingAdd();
    },
    []
  );

  const chapters: RepertoireChapterSummary[] = useMemo(() => {
    const list = detail.data?.chapters ?? [];
    return sortedChapters(
      list.map((item) =>
        draft && item.id === draft.id
          ? {
              ...item,
              title: draft.title,
              kind: draft.kind,
              enabled: draft.enabled,
              sortOrder: draft.sortOrder,
              opening: draft.opening
            }
          : item
      )
    );
  }, [detail.data, draft]);

  const decisionDrafts = useDecisionDraftCommands({ repertoireId, positionKey, decision });
  const showBook = useCallback(() => onTabChange("book"), [onTabChange]);
  const book = useStudyBook({
    repertoireId,
    chapterId,
    detail: detail.data,
    lookup,
    node,
    tab,
    onSelectNode: selectNode,
    onShowBook: showBook
  });
  const shownTab = book.shownTab;
  const { side, choices } = useStudyChoices({
    repertoireId,
    chapter: shown,
    lookup,
    kinds,
    node,
    positionKey,
    decision,
    otherOccurrences,
    color,
    staged: stagedIds,
    flags
  });
  const arrows = useRepertoireArrows(choices);

  if (!desktop) {
    return (
      <EmptyState
        className="self-center"
        icon={<GraduationCap />}
        title="Repertoires need the desktop app"
        description="Studying and saving chapters uses the app's local library."
      />
    );
  }

  if (!draft || !shown || !lookup || !node) {
    return <ChapterNotOpen loadError={loadError} onRetry={retryLoad} onHub={onHub} />;
  }

  /**
   * The move menu of `target`: the selected move's (with its position's own actions), or a move of
   * the choices panel's (its kind, preference, comment and edits). A staged move has none: it
   * isn't in the chapter yet (the New moves card handles it).
   */
  const moveMenu = (target: MoveNode, open: boolean, onOpenChange: (open: boolean) => void) => {
    if (stagedIds.has(target.id)) return null;
    const selected = target.id === node.id;
    return (
      <StudyMoveMenu
        repertoireId={repertoireId}
        chapter={shown}
        lookup={lookup}
        color={color}
        node={target}
        kind={kinds.get(target.id)}
        positionKey={selected ? positionKey : (lookup.positionKeys.get(target.id) ?? null)}
        paused={selected && paused}
        canEditDecision={selected && canEditDecision}
        otherOccurrences={selected ? otherOccurrences : []}
        canPromote={selected ? canPromote : promotionTarget(shown.tree, target.id) !== null}
        busy={commands.busy}
        open={open}
        onOpenChange={onOpenChange}
        onSetMeta={(nodeId, patch) => workspace().setNodeMeta(nodeId, patch)}
        onPrefer={(key, uci) => {
          workspace().setNodeMeta(target.id, { edge: "included" });
          void commands.writeDecision(key, { preferredUci: uci });
        }}
        onSetPaused={decisionDrafts.setPaused}
        onEditComment={() => {
          selectNode(target.id);
          setDialog("comment");
        }}
        onEditDecision={() => setDialog("decision")}
        onOpenOccurrence={(occurrence) => onOpenChapter(occurrence.chapterId, occurrence.nodeId)}
        onPromote={() => promoteVariation(target.id)}
        onDelete={() => deletion.deleteLine(target.id)}
      />
    );
  };
  const menu = moveMenu(node, menuOpen, setMenuOpen);
  const choicesPanel = (
    <StudyChoicesPanel
      side={side}
      choices={choices}
      currentChapterId={chapterId}
      renderMenu={(choice) => {
        const target = lookup.nodesById.get(choice.at.nodeId);
        return target ? (
          <ChoiceMoveMenu render={(open, setOpen) => moveMenu(target, open, setOpen)} />
        ) : null;
      }}
      onOpen={(choice) =>
        choice.at.chapterId === chapterId
          ? selectNode(choice.at.nodeId)
          : onOpenChapter(choice.at.chapterId, choice.at.nodeId)
      }
    />
  );
  /**
   * Opens `targetId` (another chapter) and hands it the staged moves, added there once it loads;
   * they stay staged here when it doesn't open.
   */
  const addElsewhere = (targetId: string) => {
    void workspace()
      .addStagedElsewhere(targetId, () => onAddToChapter(targetId))
      .catch((error: unknown) =>
        setLocalError(ipcErrorMessage(error) || "The chapter couldn't be opened.")
      );
  };

  return (
    <BoardWorkspace
      panelLabel="Repertoire study"
      tabPanel={tabPanelProps(panelId, shownTab)}
      board={
        <StudyBoardStage
          chapterTitle={draft.title}
          color={color}
          node={node}
          orientation={orientation}
          engineOpen={engineOpen}
          staged={stagedIds.has(node.id)}
          repertoireArrows={arrows}
        />
      }
      tabBar={
        <StudyTabBar
          panelId={panelId}
          repertoireId={repertoireId}
          tab={shownTab}
          chapterCount={chapters.length}
          hasBook={book.available}
          onChange={onTabChange}
          onSettings={() => setDialog("settings")}
        />
      }
      flushBody
      summary={
        <StudyLineStrip lookup={lookup} nodeId={node.id} staged={stagedIds} onSelect={selectNode} />
      }
      notices={
        <div className="grid gap-2 px-3 pt-3 empty:hidden">
          <StudyStagingNotices
            repertoireId={repertoireId}
            fromGames={fromGames}
            lookup={lookup}
            node={node}
            chapter={draft}
            staged={staged}
            color={color}
            chapters={chapters}
            busy={commands.busy}
            onPractisePosition={onPractisePosition}
            onAddElsewhere={addElsewhere}
            onAddToNewChapter={(title) =>
              void commands
                .addChapter(title, draft.rootFen, nextSortOrder(chapters))
                .then((id) => id && addElsewhere(id))
            }
          />
          <ChapterSaveNotice detail={detail} chapterQuery={chapterQuery} />
          <FailedDecisionNotices repertoireId={repertoireId} lookup={lookup} />
          <LoadErrorNotice loadError={loadError} onRetry={retryLoad} />
          <StudyErrorNotice
            commandError={commands.error}
            localError={localError}
            onDismiss={() => {
              commands.clearError();
              setLocalError(null);
            }}
          />
          <DeletedLineNotice deletion={deletion} />
        </div>
      }
      footer={
        <>
          <RepertoireMoveNavigation
            nodes={shown.tree}
            selectedNodeId={node.id}
            onSelect={selectNode}
          />
          <StudyPracticeFooter
            blocker={blocker}
            chapterTitle={draft.title}
            lookup={lookup}
            color={color}
            busy={commands.busy || include.including}
            widening={include.widening}
            onMakeTrainable={include.includeInPractice}
            onConfirmWidening={include.confirmWidening}
            onCancelWidening={include.cancelWidening}
            onSetMeta={(nodeId, patch) => workspace().setNodeMeta(nodeId, patch)}
            onPractice={onPractice}
          />
        </>
      }
    >
      {shownTab === "book" ? (
        <StudyBookTab pages={book.pages} page={book.page} onPage={book.turnTo} />
      ) : shownTab === "explorer" ? (
        <StudyExplorerTab
          repertoireId={repertoireId}
          fen={node.fenAfter}
          onStage={(ucis) => void workspace().playLine(node.id, ucis)}
          onOpenFlag={onOpenFlag}
        />
      ) : shownTab === "chapters" ? (
        <div className="h-full p-3">
          <StudyChaptersPanel
            chapters={chapters}
            currentChapterId={chapterId}
            busy={commands.busy}
            onOpen={(id) => id !== chapterId && onOpenChapter(id)}
            onRename={(id, title) => void commands.editChapter(id, { title })}
            onEditOpening={(id, opening) => void commands.editChapter(id, { opening })}
            onSetEnabled={(id, enabled) => void commands.editChapter(id, { enabled })}
            onSetKind={(id, kind) => void commands.editChapter(id, { kind })}
            onSetMany={(ids, patch) => void commands.editChapters(ids, patch)}
            onMove={(id, direction) => void commands.moveChapter(chapters, id, direction)}
            onAdd={(title) =>
              void commands
                .addChapter(title, draft.rootFen, nextSortOrder(chapters))
                .then((id) => id && onOpenChapter(id))
            }
            onRemove={(id) => void removeChapter(id)}
            footer={
              <>
                <BookChapterReport
                  pages={book.pages}
                  chapterId={chapterId}
                  onOpenPage={book.openPage}
                />
                <StudySourcesSection
                  repertoireId={repertoireId}
                  chapterId={chapterId}
                  onOpenGame={onOpenGame}
                />
              </>
            }
          />
        </div>
      ) : (
        <StudyMovesTab
          chapter={shown}
          lookup={lookup}
          node={node}
          orientation={orientation}
          kinds={kinds}
          staged={stagedIds}
          moveFlags={moveFlags}
          choices={choicesPanel}
          engineOpen={engineOpen}
          menu={menu}
          bookPages={book.links}
          onSelectNode={selectNode}
          onOpenMenu={() => setMenuOpen(true)}
          onOpenEngineSettings={onOpenEngineSettings}
        />
      )}
      {dialog ? (
        <StudyDialogs
          dialog={dialog}
          repertoireId={repertoireId}
          detail={detail.data}
          node={node}
          positionKey={canEditDecision ? positionKey : null}
          decision={decision}
          busy={commands.busy}
          drafts={decisionDrafts}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </BoardWorkspace>
  );
}

type StudyDialog = "comment" | "decision" | "settings";

/**
 * The dialog open over Study: the selected move's comment, its practice texts (where it has a
 * decision: `positionKey`), or the repertoire settings.
 */
function StudyDialogs({
  dialog,
  repertoireId,
  detail,
  node,
  positionKey,
  decision,
  busy,
  drafts,
  onClose
}: {
  dialog: StudyDialog;
  repertoireId: string;
  detail: RepertoireDetail | undefined;
  node: MoveNode;
  positionKey: string | null;
  decision: RepertoireDecision | null;
  busy: boolean;
  drafts: ReturnType<typeof useDecisionDraftCommands>;
  onClose: () => void;
}) {
  if (dialog === "comment") {
    return (
      <StudyCommentDialog
        node={node}
        onComment={(text) => workspace().setComment(node.id, text)}
        onClose={onClose}
      />
    );
  }
  if (dialog === "settings") {
    return detail ? <RepertoireSettingsDialog detail={detail} study onClose={onClose} /> : null;
  }
  return positionKey ? (
    <StudyDecisionDialog
      node={node}
      repertoireId={repertoireId}
      positionKey={positionKey}
      decision={decision}
      busy={busy}
      onDecisionTextChange={drafts.changeDecisionText}
      onCommitDecisionText={drafts.commitDecisionText}
      onFeedbackChange={drafts.changeFeedback}
      onCommitFeedback={drafts.commitFeedback}
      onClose={onClose}
    />
  ) : null;
}

/**
 * The panel's title bar: Moves · Chapters (their count) · Book (from a book), then Undo and Redo on Moves, Export PGN
 * (the whole repertoire) and the repertoire settings, last.
 */
function StudyTabBar({
  panelId,
  repertoireId,
  tab,
  chapterCount,
  hasBook,
  onChange,
  onSettings
}: {
  panelId: string;
  repertoireId: string;
  tab: StudyTab;
  chapterCount: number;
  hasBook: boolean;
  onChange: (tab: StudyTab) => void;
  onSettings: () => void;
}) {
  const canUndo = useRepertoireWorkspaceStore((state) => state.undoStack.length > 0);
  const canRedo = useRepertoireWorkspaceStore((state) => state.redoStack.length > 0);
  const editLabels = studyEditShortcutLabels(isElectronMac());
  const exportPgn = useExportRepertoireMutation();
  const notice = () => useAppNoticeStore.getState();
  return (
    <WorkspaceTabBar
      panelId={panelId}
      ariaLabel="Study panels"
      tabs={studyTabs(chapterCount, hasBook)}
      value={tab}
      onChange={onChange}
      actions={
        <>
          {tab === "moves" ? (
            <>
              <IconButton
                label="Undo"
                icon={<Undo2 />}
                size="icon-xs"
                disabled={!canUndo}
                aria-keyshortcuts={editLabels.undo.aria}
                onClick={() => workspace().undo()}
              />
              <IconButton
                label="Redo"
                icon={<Redo2 />}
                size="icon-xs"
                disabled={!canRedo}
                aria-keyshortcuts={editLabels.redo.aria}
                onClick={() => workspace().redo()}
              />
            </>
          ) : null}
          <IconButton
            label="Export PGN"
            icon={<ExportIcon />}
            size="icon-xs"
            disabled={exportPgn.isPending}
            onClick={() =>
              exportPgn.mutate(
                { repertoireId },
                {
                  onSuccess: (result) => {
                    if (result.savedPath) {
                      notice().show(
                        `Exported ${plural(result.chapterCount, "chapter")} to ${result.savedPath}.`,
                        { tone: "success" }
                      );
                    }
                  },
                  onError: (error) =>
                    notice().show(ipcErrorMessage(error) || "Couldn't export the PGN.")
                }
              )
            }
          />
          <IconButton
            label="Repertoire settings"
            icon={<Settings />}
            size="icon-xs"
            onClick={onSettings}
          />
        </>
      }
    />
  );
}

/**
 * The book behind a repertoire imported from one (tagged `book`): its pages, the page the Book tab
 * shows (the selected move's, or one turned to since), the chips' labels, and showing a page.
 * The Book tab is `available` once the pages are read (a repertoire without them never has it);
 * `tab` asking for it without one (an old history entry, say) shows the moves (`shownTab`).
 */
function useStudyBook({
  repertoireId,
  chapterId,
  detail,
  lookup,
  node,
  tab,
  onSelectNode,
  onShowBook
}: {
  repertoireId: string;
  chapterId: string;
  detail: RepertoireDetail | undefined;
  lookup: ChapterLookup | null;
  node: MoveNode | null;
  tab: StudyTab;
  onSelectNode: (nodeId: string) => void;
  onShowBook: () => void;
}): {
  available: boolean;
  shownTab: StudyTab;
  pages: BookPages | null;
  page: number | null;
  links: BookPageLinks | undefined;
  turnTo: (page: number) => void;
  openPage: (page: number) => void;
} {
  // The book's link (main/books), not an editable tag: a copy of the repertoire has none.
  const isBook = Boolean(detail?.bookId);
  const selectedNodeId = node?.id ?? null;
  const query = useBookPagesQuery(repertoireId, isBook);
  const pages = query.data ?? null;
  /** A page turned to while a move was selected (`anchor`: chapter and move). */
  const [view, setView] = useState<{ nodeId: string; page: number } | null>(null);
  const anchor = `${chapterId}/${selectedNodeId ?? ""}`;
  const movePage =
    pages && lookup && selectedNodeId
      ? bookPageAt(lookup, selectedNodeId, chapterFirstPage(pages, chapterId))
      : null;
  const page = pages ? shownBookPage(movePage, view, anchor, pages.pages.length) : null;
  const turnTo = useCallback((next: number) => setView({ nodeId: anchor, page: next }), [anchor]);
  const openPage = useCallback(
    (next: number) => {
      setView({ nodeId: anchor, page: next });
      onShowBook();
    },
    [anchor, onShowBook]
  );
  const links = useMemo<BookPageLinks | undefined>(
    () =>
      pages
        ? {
            label: (target) => bookPageLabel(pages, target),
            onOpen: (nodeId, target) => {
              onSelectNode(nodeId);
              setView({ nodeId: `${chapterId}/${nodeId}`, page: target });
              onShowBook();
            }
          }
        : undefined,
    [pages, chapterId, onSelectNode, onShowBook]
  );
  const available = isBook && (pages !== null || query.isPending);
  return {
    available,
    shownTab: tab === "book" && !available ? "moves" : tab,
    pages,
    page,
    links,
    turnTo,
    openPage
  };
}

/** Before the chapter is in the draft: why it couldn't be read (Retry, Back), or loading. */
function ChapterNotOpen({
  loadError,
  onRetry,
  onHub
}: {
  loadError: string | null;
  onRetry: () => void;
  onHub?: () => void;
}) {
  if (loadError === null) {
    return (
      <div className="grid place-items-center" role="status" aria-label="Loading chapter">
        <Loader2 className="size-5 animate-spin text-fg-subtle" />
      </div>
    );
  }
  return (
    <EmptyState
      className="self-center"
      icon={<CircleAlert />}
      title="This chapter couldn't be opened"
      description={loadError}
      action={
        <div className="flex gap-2">
          <Button type="button" variant="primary" size="sm" onClick={onRetry}>
            Retry
          </Button>
          {onHub ? (
            <Button type="button" variant="outline" size="sm" onClick={onHub}>
              Back to repertoires
            </Button>
          ) : null}
        </div>
      }
    />
  );
}
