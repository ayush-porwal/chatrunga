import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { CircleAlert, GraduationCap, Loader2, Redo2, Settings, Undo2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type { ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import type { Color, MoveNode } from "@chaturanga/shared/types/chess";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type RepertoireChapter,
  type RepertoireChapterSummary,
  type RepertoireDecision,
  type RepertoireDetail
} from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { tabPanelProps } from "@/components/ui/segmented-control";
import { isElectronMac } from "@/lib/environment";
import { ipcErrorMessage } from "@/lib/ipc-error";
import {
  useExportRepertoireMutation,
  useRepertoireChapterQuery,
  useRepertoireQuery
} from "../../queries/repertoire";
import { useAppNoticeStore } from "../../stores/app-notice-store";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { useStudyEngineStore } from "../../stores/study-engine-store";
import { DESTINATION_ICONS } from "../../app/destination-icons";
import { BoardWorkspace } from "../board/BoardWorkspace";
import { WorkspaceTabBar, type WorkspaceTab } from "../board/WorkspaceTabBar";
import { nextSortOrder, plural, sortedChapters, type StudyStage } from "./repertoire-chapters";
import { moveKinds, type MoveKind } from "./repertoire-model";
import { RepertoireMoveNavigation } from "./RepertoireMoveNavigation";
import { RepertoireSettingsDialog } from "./RepertoireSettingsDialog";
import { StudyBoardStage } from "./StudyBoardStage";
import { StudyChaptersPanel } from "./StudyChaptersPanel";
import { StudyEnginePanel } from "./StudyEnginePanel";
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
import { StudyTree } from "./StudyTree";
import { useChapterAutosave } from "./useChapterAutosave";
import { useChapterDraftLoad } from "./useChapterDraftLoad";
import { studyEditShortcutLabels } from "./study-edit-shortcuts";
import { useDecisionDraftCommands } from "./useDecisionDraftCommands";
import { useIncludeInPractice } from "./useIncludeInPractice";
import { useMissingChapterHandoff } from "./useMissingChapterHandoff";
import { useMoveTreeEditing } from "./useMoveTreeEditing";
import { useStudyCommands } from "./useStudyCommands";
import { useStudyPosition } from "./useStudyPosition";
import { useStudyTraining } from "./useStudyTraining";

export type StudyTab = "moves" | "chapters";

/** The panel's tabs, in order (a list, so another panel can join it). */
function studyTabs(chapterCount: number): WorkspaceTab<StudyTab>[] {
  return [
    { value: "moves", label: "Moves" },
    { value: "chapters", label: "Chapters", count: chapterCount }
  ];
}

const workspace = () => useRepertoireWorkspaceStore.getState();
const ExportIcon = DESTINATION_ICONS.exportPgn;

/**
 * Repertoire study (design §5.2), laid out as Analysis: the chapter on a store-free board (both
 * sides playable while authoring; drawing on) and the panel's title-bar tabs, Moves (the engine
 * when Analyze is on, then the tree with its comments; the selected move's actions in one menu)
 * and Chapters (with the open chapter's linked games). Edits go to the workspace draft and
 * autosave against the repertoire revision; nothing passes through the game store. A chapter or
 * repertoire that no longer exists hands back to the hub (`onMissing`); any other failure to read
 * them keeps the page (and the draft) with the cause and Retry. The footer steps through the
 * moves and starts Practice.
 */
export function RepertoireStudyPage({
  repertoireId,
  chapterId,
  initialNodeId,
  initialOrientation,
  tab,
  stage,
  onStageApplied,
  onTabChange,
  onOpenChapter,
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
  onTabChange: (tab: StudyTab) => void;
  /** Opens a chapter (at a node: a transposition elsewhere); the open draft is saved first. */
  onOpenChapter: (chapterId: string, nodeId?: string | null) => void;
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
  const { draft, selectedNodeId, orientation, color, loadedId } = useRepertoireWorkspaceStore(
    useShallow((state) => {
      const loaded = state.repertoireId === repertoireId && state.chapterId === chapterId;
      return {
        draft: loaded ? state.chapter : null,
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

  const { lookup, node, positionKey, decision, otherOccurrences, canEditDecision } =
    useStudyPosition({ repertoireId, chapterId, chapter: draft, selectedNodeId, color });
  const blocker = useStudyTraining({ chapter: draft, lookup, color });
  const include = useIncludeInPractice({ repertoireId, chapterId, color, setError: setLocalError });
  const { selectNode, deletion, promoteVariation, canPromote } = useMoveTreeEditing({
    chapter: draft,
    lookup,
    selectedNodeId
  });
  const kinds = useMemo(
    () => (draft && lookup ? moveKinds(draft, lookup, color) : new Map<string, MoveKind>()),
    [draft, lookup, color]
  );
  const paused = usePausedAt(repertoireId, positionKey, decision?.paused ?? false);

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
              sortOrder: draft.sortOrder
            }
          : item
      )
    );
  }, [detail.data, draft]);

  const decisionDrafts = useDecisionDraftCommands({ repertoireId, positionKey, decision });

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

  if (!draft || !lookup || !node) {
    return <ChapterNotOpen loadError={loadError} onRetry={retryLoad} onHub={onHub} />;
  }

  const menu = (
    <StudyMoveMenu
      repertoireId={repertoireId}
      chapter={draft}
      lookup={lookup}
      color={color}
      node={node}
      kind={kinds.get(node.id)}
      positionKey={positionKey}
      paused={paused}
      canEditDecision={canEditDecision}
      otherOccurrences={otherOccurrences}
      canPromote={canPromote}
      busy={commands.busy}
      open={menuOpen}
      onOpenChange={setMenuOpen}
      onSetMeta={(nodeId, patch) => workspace().setNodeMeta(nodeId, patch)}
      onPrefer={(key, uci) => {
        workspace().setNodeMeta(node.id, { edge: "included" });
        void commands.writeDecision(key, { preferredUci: uci });
      }}
      onSetPaused={decisionDrafts.setPaused}
      onEditComment={() => setDialog("comment")}
      onEditDecision={() => setDialog("decision")}
      onOpenOccurrence={(occurrence) => onOpenChapter(occurrence.chapterId, occurrence.nodeId)}
      onPromote={() => promoteVariation(node.id)}
      onDelete={() => deletion.deleteLine(node.id)}
    />
  );

  return (
    <BoardWorkspace
      panelLabel="Repertoire study"
      tabPanel={tabPanelProps(panelId, tab)}
      board={
        <StudyBoardStage
          chapterTitle={draft.title}
          color={color}
          lookup={lookup}
          node={node}
          orientation={orientation}
          engineOpen={engineOpen}
        />
      }
      tabBar={
        <StudyTabBar
          panelId={panelId}
          repertoireId={repertoireId}
          tab={tab}
          chapterCount={chapters.length}
          onChange={onTabChange}
          onSettings={() => setDialog("settings")}
        />
      }
      flushBody
      notices={
        <div className="grid gap-2 px-3 pt-3 empty:hidden">
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
            nodes={draft.tree}
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
      {tab === "chapters" ? (
        <div className="h-full p-3">
          <StudyChaptersPanel
            chapters={chapters}
            currentChapterId={chapterId}
            busy={commands.busy}
            onOpen={(id) => id !== chapterId && onOpenChapter(id)}
            onRename={(id, title) => void commands.editChapter(id, { title })}
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
              <StudySourcesSection
                repertoireId={repertoireId}
                chapterId={chapterId}
                onOpenGame={onOpenGame}
              />
            }
          />
        </div>
      ) : (
        <StudyMovesTab
          chapter={draft}
          lookup={lookup}
          node={node}
          orientation={orientation}
          kinds={kinds}
          engineOpen={engineOpen}
          menu={menu}
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
    return detail ? <RepertoireSettingsDialog detail={detail} onClose={onClose} /> : null;
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
 * The Moves tab: the engine (while Analyze is on) at the top, as Analysis's, then the starting
 * position's row and the tree with its comments, the selected move carrying its menu (`menu`;
 * a right-click on a move opens it too).
 */
function StudyMovesTab({
  chapter,
  lookup,
  node,
  orientation,
  kinds,
  engineOpen,
  menu,
  onSelectNode,
  onOpenMenu,
  onOpenEngineSettings
}: {
  chapter: RepertoireChapter;
  lookup: ChapterLookup;
  node: MoveNode;
  orientation: Color;
  kinds: ReadonlyMap<string, MoveKind>;
  engineOpen: boolean;
  menu: ReactNode;
  onSelectNode: (nodeId: string) => void;
  onOpenMenu: () => void;
  onOpenEngineSettings?: () => void;
}) {
  const atRoot = node.id === REPERTOIRE_ROOT_NODE_ID;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {engineOpen ? (
        <StudyEnginePanel
          chapter={chapter}
          node={node}
          orientation={orientation}
          onClose={() => useStudyEngineStore.getState().close()}
          onOpenSettings={onOpenEngineSettings}
        />
      ) : null}
      <StartRow
        selected={atRoot}
        comment={lookup.nodesById.get(REPERTOIRE_ROOT_NODE_ID)?.comment ?? null}
        menu={atRoot ? menu : null}
        onSelect={() => onSelectNode(REPERTOIRE_ROOT_NODE_ID)}
        onContextMenu={() => {
          onSelectNode(REPERTOIRE_ROOT_NODE_ID);
          onOpenMenu();
        }}
      />
      <StudyTree
        key={chapter.id}
        className="flex-1 px-3 pb-3"
        lookup={lookup}
        kinds={kinds}
        selectedNodeId={node.id}
        onSelectNode={onSelectNode}
        showComments
        selectedActions={atRoot ? undefined : menu}
        onMoveContextMenu={onOpenMenu}
        emptyLabel="No moves yet — play the first move on the board."
        ariaLabel="Chapter moves"
      />
    </div>
  );
}

/**
 * The tree's first row: the chapter's starting position (selectable, with its menu while selected
 * and its comment under it), as the moves after it are.
 */
function StartRow({
  selected,
  comment,
  menu,
  onSelect,
  onContextMenu
}: {
  selected: boolean;
  comment: string | null;
  menu: ReactNode;
  onSelect: () => void;
  onContextMenu: () => void;
}) {
  return (
    <div className="shrink-0 px-3 pt-2">
      <div
        className={
          selected
            ? "relative flex h-8 items-center rounded-[0.3125rem] bg-accent-soft"
            : "relative flex h-8 items-center rounded-[0.3125rem] hover:bg-control"
        }
      >
        <button
          type="button"
          aria-current={selected ? "step" : undefined}
          className={
            selected
              ? "flex h-8 flex-1 items-center rounded-[0.3125rem] px-2 text-left text-xs font-semibold text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              : "flex h-8 flex-1 items-center rounded-[0.3125rem] px-2 text-left text-xs text-fg-muted outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          }
          onClick={onSelect}
          onContextMenu={(event) => {
            event.preventDefault();
            onContextMenu();
          }}
        >
          Starting position
        </button>
        {menu ? <span className="absolute right-0.5 flex">{menu}</span> : null}
      </div>
      {comment?.trim() ? (
        <p className="px-2 pt-1 text-xs leading-relaxed whitespace-pre-line text-fg-muted">
          {comment.trim()}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The panel's title bar: Moves · Chapters (their count), then Undo and Redo on Moves, Export PGN
 * (the whole repertoire) and the repertoire settings, last.
 */
function StudyTabBar({
  panelId,
  repertoireId,
  tab,
  chapterCount,
  onChange,
  onSettings
}: {
  panelId: string;
  repertoireId: string;
  tab: StudyTab;
  chapterCount: number;
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
      tabs={studyTabs(chapterCount)}
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
