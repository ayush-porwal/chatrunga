import { useEffect, useId, useMemo, useState } from "react";
import { ArrowUpToLine, CircleAlert, GraduationCap, Loader2, Redo2, Undo2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { statusForFen } from "@chaturanga/shared/chess/position";
import type { Color } from "@chaturanga/shared/types/chess";
import type { RepertoireChapterSummary } from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  SegmentedControl,
  tabPanelProps,
  type SegmentedOption
} from "@/components/ui/segmented-control";
import { SideDot } from "@/components/ui/side-dot";
import { Stat, StatGroup } from "@/components/ui/stat";
import { isElectronMac } from "@/lib/environment";
import { useRepertoireChapterQuery, useRepertoireQuery } from "../../queries/repertoire";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { selectLiveGameInProgress, useLichessStore } from "../../stores/lichess-store";
import { BoardWorkspace, workspaceTabsClass } from "../board/BoardWorkspace";
import { nextSortOrder, sortedChapters, type StudyStage } from "./repertoire-chapters";
import type { RehearseTarget } from "./practice-setup";
import { RepertoireMoveNavigation } from "./RepertoireMoveNavigation";
import { LIVE_GAME_NOTICE, NO_MOVES_TO_PLAY } from "./handoffs";
import { StudyBoardStage } from "./StudyBoardStage";
import { StudyChaptersPanel } from "./StudyChaptersPanel";
import { StudyChoicesPanel } from "./StudyChoicesPanel";
import { StudyDecisionPractice } from "./StudyDecisionPractice";
import { StudyEnginePanel } from "./StudyEnginePanel";
import {
  ChapterSaveNotice,
  DeletedLineNotice,
  FailedDecisionNotices,
  LoadErrorNotice,
  StudyErrorNotice
} from "./StudyNotices";
import { StudyNotesPanel } from "./StudyNotesPanel";
import { StudyPositionActions } from "./StudyPositionActions";
import { StudyPracticeBar } from "./StudyPracticeBar";
import { StudySourcesSection } from "./StudySourcesSection";
import { StudyTrainingNotice } from "./StudyTrainingNotice";
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
import { useStudyPracticeHandoffs } from "./useStudyPracticeHandoffs";
import { useStudyTraining } from "./useStudyTraining";

export type StudyTab = "chapters" | "moves" | "notes";

const tabOptions: readonly SegmentedOption<StudyTab>[] = [
  { value: "chapters", label: "Chapters" },
  { value: "moves", label: "Moves" },
  { value: "notes", label: "Notes" }
];

const workspace = () => useRepertoireWorkspaceStore.getState();

/**
 * Repertoire study (design §5.2): the chapter on a store-free board (both sides playable while
 * authoring; drawing on), its tree, choices and boundaries, chapters and notes. Edits go to the
 * workspace draft and autosave against the repertoire revision; nothing passes through the game
 * store. A chapter or repertoire that no longer exists hands back to the hub (`onMissing`); any
 * other failure to read them keeps the page (and the draft) with the cause and Retry.
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
  onRehearse,
  onMissing,
  onHub,
  onPositionChanged,
  onOpenGame,
  onOpenEngineSettings,
  onPlayFromHere
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
  onPractice: (chapterIds: string[]) => void;
  /** Rehearse lines of this chapter, from its start or from a node (the draft is saved first). */
  onRehearse?: (target: RehearseTarget) => void;
  onMissing: (message: string) => void;
  /** Back to the repertoire hub (offered when the chapter couldn't be read). */
  onHub?: () => void;
  /** The selected node, tab or orientation changed (the current history entry follows). */
  onPositionChanged: () => void;
  /** A source link's saved game, opened on the board at the linked move. */
  onOpenGame?: (gameId: string, nodeId: string | null) => void;
  /** Settings' engines, offered by the engine panel (Analyze) when no engine is installed. */
  onOpenEngineSettings?: () => void;
  /** "Play from here": an engine game from the selected position, as the repertoire's colour. */
  onPlayFromHere?: () => void;
}) {
  const panelId = useId();
  const enginePanelId = useId();
  const desktop = Boolean(window.chaturanga?.repertoires);
  const detail = useRepertoireQuery(repertoireId);
  const chapterQuery = useRepertoireChapterQuery(repertoireId, chapterId);
  const { flush } = useChapterAutosave();
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
  /**
   * The chapter the engine panel (Analyze) is open for: another chapter closes it, which stops
   * its search (as closing it or leaving Study does).
   */
  const [engineChapterId, setEngineChapterId] = useState<string | null>(null);
  const engineOpen = engineChapterId === chapterId;

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

  const { lookup, node, positionKey, decision, otherOccurrences, playerToMove, canEditDecision } =
    useStudyPosition({ repertoireId, chapterId, chapter: draft, selectedNodeId, color });
  const { blocker, decisionCount, rehearsal, availability } = useStudyTraining({
    repertoireId,
    chapter: draft,
    lookup,
    color
  });
  const practiceReasonId = useId();
  const onlineGameLive = useLichessStore(selectLiveGameInProgress);
  const include = useIncludeInPractice({ repertoireId, chapterId, color, setError: setLocalError });
  const { selectNode, deletion, promoteVariation, canPromote } = useMoveTreeEditing({
    chapter: draft,
    lookup,
    selectedNodeId
  });
  const handoffs = useStudyPracticeHandoffs({
    chapterId,
    node,
    rehearsal,
    flush,
    setError: setLocalError,
    onPractice,
    onRehearse
  });

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

  const unavailable = positionActionsUnavailable(node.fenAfter, onlineGameLive);

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
      tabs={
        <SegmentedControl
          ariaLabel="Study panels"
          role="tablist"
          panelId={panelId}
          fullWidth
          className={workspaceTabsClass}
          value={tab}
          onChange={onTabChange}
          options={tabOptions}
        />
      }
      summary={
        // The position's facts, then what can be done with it: Analyze (the engine panel, which
        // opens just below) and Play from here.
        <div className="flex w-full min-w-0 items-center gap-3">
          <PositionStats
            fen={node.fenAfter}
            playerToMove={playerToMove}
            decisionCount={decisionCount}
          />
          <StudyPositionActions
            engineOpen={engineOpen}
            enginePanelId={enginePanelId}
            analyzeUnavailable={unavailable.analyze}
            onToggleEngine={() => setEngineChapterId(engineOpen ? null : chapterId)}
            playUnavailable={unavailable.play}
            onPlayFromHere={onPlayFromHere}
          />
        </div>
      }
      notices={
        <>
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
          {/* Under the notices and above the tab, so the moves stay in view while the engine runs. */}
          {engineOpen ? (
            <StudyEnginePanel
              id={enginePanelId}
              chapter={draft}
              node={node}
              orientation={orientation}
              onClose={() => setEngineChapterId(null)}
              onOpenSettings={onOpenEngineSettings}
            />
          ) : null}
        </>
      }
      footer={
        <>
          <RepertoireMoveNavigation
            nodes={draft.tree}
            selectedNodeId={node.id}
            onSelect={selectNode}
          />
          <StudyPracticeBar
            reasonId={practiceReasonId}
            availability={availability}
            onPractice={handoffs.practiceChapter}
            onRehearse={handoffs.rehearseChapter}
          />
        </>
      }
    >
      {tab === "chapters" ? (
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
        />
      ) : null}
      {tab === "moves" ? (
        <div className="scroll-area -mr-3 flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-3">
          {blocker ? (
            <StudyTrainingNotice
              blocker={blocker}
              chapterTitle={draft.title}
              lookup={lookup}
              color={color}
              selectedNodeId={node.id}
              busy={commands.busy || include.including}
              widening={include.widening}
              onMakeTrainable={include.includeInPractice}
              onConfirmWidening={include.confirmWidening}
              onCancelWidening={include.cancelWidening}
              onSetMeta={(nodeId, patch) => workspace().setNodeMeta(nodeId, patch)}
              onSelectNode={selectNode}
            />
          ) : null}
          {/* About three rows of moves at least, also under the engine panel (the tab scrolls on to the choices). */}
          <section className="flex max-h-[45%] min-h-40 shrink-0 flex-col" aria-label="Moves">
            <MoveTreeEditBar canPromote={canPromote} onPromote={() => promoteVariation(node.id)} />
            <StudyTree
              key={chapterId}
              lookup={lookup}
              selectedNodeId={node.id}
              onSelectNode={selectNode}
              onDeleteLine={deletion.deleteLine}
              onPromoteVariation={promoteVariation}
              emptyLabel="No moves yet — play the first move on the board."
              ariaLabel="Chapter moves"
            />
          </section>
          <StudyChoicesPanel
            chapter={draft}
            lookup={lookup}
            color={color}
            selectedNodeId={node.id}
            decision={decision}
            busy={commands.busy}
            onSetEdge={(nodeId, edge) => workspace().setNodeMeta(nodeId, { edge })}
            onPrefer={(row) => {
              workspace().setNodeMeta(row.nodeId, { edge: "included" });
              if (positionKey) void commands.writeDecision(positionKey, { preferredUci: row.uci });
            }}
            onSetMeta={(nodeId, patch) => workspace().setNodeMeta(nodeId, patch)}
            onSelectNode={selectNode}
            otherOccurrences={otherOccurrences}
            onOpenOccurrence={(occurrence) =>
              onOpenChapter(occurrence.chapterId, occurrence.nodeId)
            }
            onRehearseFromHere={handoffs.rehearseFromHere}
          />
        </div>
      ) : null}
      {tab === "notes" ? (
        <StudyNotesPanel
          key={node.id}
          node={node}
          decisionText={decision}
          repertoireId={repertoireId}
          positionKey={positionKey}
          canEditDecision={canEditDecision}
          busy={commands.busy}
          onComment={(text) => workspace().setComment(node.id, text)}
          onDecisionTextChange={decisionDrafts.changeDecisionText}
          onCommitDecisionText={decisionDrafts.commitDecisionText}
          decisionControls={
            playerToMove ? (
              <StudyDecisionPractice
                // A move and text picked for "Add feedback" belong to this position only.
                key={positionKey ?? ""}
                repertoireId={repertoireId}
                positionKey={positionKey}
                fen={node.fenAfter}
                decision={decision}
                canEditDecision={canEditDecision}
                busy={commands.busy}
                onFeedbackChange={decisionDrafts.changeFeedback}
                onCommitFeedback={decisionDrafts.commitFeedback}
                onSetPaused={decisionDrafts.setPaused}
              />
            ) : null
          }
          footer={
            <StudySourcesSection
              repertoireId={repertoireId}
              chapterId={chapterId}
              onOpenGame={onOpenGame}
            />
          }
        />
      ) : null}
    </BoardWorkspace>
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

/**
 * Why Play from here can't start (it also waits for the chapter to load). A study action: a
 * chapter left out of practice is still played from. The engine panel too, while closed (open, it
 * says so itself and can always be closed). Null: it can.
 */
function positionActionsUnavailable(
  fen: string,
  onlineGameLive: boolean
): { play: string | null; analyze: string | null } {
  if (statusForFen(fen).isEnd) return { play: NO_MOVES_TO_PLAY, analyze: NO_MOVES_TO_PLAY };
  if (onlineGameLive) {
    return { play: LIVE_GAME_NOTICE, analyze: "The engine is off during your Lichess game." };
  }
  return { play: null, analyze: null };
}

/** The position's facts: who is to move, and the chapter's decision count. */
function PositionStats({
  fen,
  playerToMove,
  decisionCount
}: {
  fen: string;
  playerToMove: boolean;
  decisionCount: number;
}) {
  const turn: Color = fen.split(" ")[1] === "b" ? "black" : "white";
  return (
    <StatGroup className="min-w-0 flex-1 auto-cols-[minmax(0,max-content)] gap-5">
      <Stat
        label="To move"
        value={
          <span className="inline-flex items-center gap-2">
            <SideDot color={turn} />
            {playerToMove ? "You" : "Opponent"}
          </span>
        }
      />
      <Stat label="Decisions" value={`${decisionCount} in this chapter`} />
    </StatGroup>
  );
}

/** Undo, Redo and Promote variation above the move tree (with their keyboard shortcuts). */
function MoveTreeEditBar({
  canPromote,
  onPromote
}: {
  canPromote: boolean;
  onPromote: () => void;
}) {
  const canUndo = useRepertoireWorkspaceStore((state) => state.undoStack.length > 0);
  const canRedo = useRepertoireWorkspaceStore((state) => state.redoStack.length > 0);
  const editLabels = studyEditShortcutLabels(isElectronMac());
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-1 pb-1"
      role="group"
      aria-label="Edit the move tree"
    >
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={!canUndo}
          title={`Undo the last change to the moves or their training marks (${editLabels.undo.label})`}
          aria-keyshortcuts={editLabels.undo.aria}
          onClick={() => workspace().undo()}
        >
          <Undo2 />
          Undo
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={!canRedo}
          title={`Redo (${editLabels.redo.label})`}
          aria-keyshortcuts={editLabels.redo.aria}
          onClick={() => workspace().redo()}
        >
          <Redo2 />
          Redo
        </Button>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={!canPromote}
        title={`Move the selected variation up in this chapter's order, which PGN export writes as its main line (${editLabels.promote.label}). What practice expects stays as set under Choices.`}
        aria-keyshortcuts={editLabels.promote.aria}
        onClick={onPromote}
      >
        <ArrowUpToLine />
        Promote variation
      </Button>
    </div>
  );
}
