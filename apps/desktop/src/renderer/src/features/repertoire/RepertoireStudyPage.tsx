import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpToLine,
  CircleAlert,
  GraduationCap,
  Loader2,
  Redo2,
  Route,
  Undo2
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { statusForFen } from "@chaturanga/shared/chess/position";
import { buildChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import {
  DEFAULT_REHEARSAL_DEPTH_PLIES,
  canRehearseFrom,
  lineEnds,
  rehearsalContext
} from "@chaturanga/shared/chess/repertoire-rehearsal";
import { chapterTraining, type AcceptedAt } from "@chaturanga/shared/chess/repertoire-training";
import type { BoardArrow, BoardHighlight, Color } from "@chaturanga/shared/types/chess";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type RepertoireChapter,
  type RepertoireChapterSummary
} from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import {
  SegmentedControl,
  tabPanelProps,
  type SegmentedOption
} from "@/components/ui/segmented-control";
import { SideDot } from "@/components/ui/side-dot";
import { Stat, StatGroup } from "@/components/ui/stat";
import { isElectronMac } from "@/lib/environment";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useEventCallback } from "@/lib/use-event-callback";
import { cn } from "@/lib/utils";
import {
  fetchPractisedElsewhere,
  useRepertoireChapterQuery,
  useRepertoireDecisionQuery,
  useRepertoireOccurrencesQuery,
  useRepertoirePausedKeysQuery,
  useRepertoireQuery
} from "../../queries/repertoire";
import {
  playUci,
  promotionTarget,
  useRepertoireWorkspaceStore
} from "../../stores/repertoire-workspace-store";
import { selectLiveGameInProgress, useLichessStore } from "../../stores/lichess-store";
import { BoardStage, BoardWorkspace, workspaceTabsClass } from "../board/BoardWorkspace";
import { ControlledBoard } from "../board/ControlledBoard";
import {
  COLOR_LABELS,
  nextSortOrder,
  sortedChapters,
  type StudyStage
} from "./repertoire-chapters";
import {
  decisionDraftKey,
  decisionDraftMatches,
  decisionDraftName,
  deriveChoices,
  isNotFoundError,
  occurrencesInOtherChapters,
  lastMoveOf,
  pathLabel,
  type DecisionTextDraft,
  type DecisionTextField
} from "./repertoire-model";
import type { RehearseTarget } from "./practice-setup";
import { RepertoireMoveNavigation, useTreeKeyboardNavigation } from "./RepertoireMoveNavigation";
import { LIVE_GAME_NOTICE, NO_MOVES_TO_PLAY } from "./handoffs";
import { StudyChaptersPanel } from "./StudyChaptersPanel";
import { StudyChoicesPanel } from "./StudyChoicesPanel";
import { StudyDecisionPractice } from "./StudyDecisionPractice";
import { StudyEnginePanel, StudyEvalBar } from "./StudyEnginePanel";
import { StudyNotesPanel } from "./StudyNotesPanel";
import { StudyPositionActions } from "./StudyPositionActions";
import { StudySourcesSection } from "./StudySourcesSection";
import { StudyTrainingNotice } from "./StudyTrainingNotice";
import { StudyTree } from "./StudyTree";
import {
  blockerExplanation,
  currentIncludePlan,
  studyPracticeAvailability,
  wideningQuestion
} from "./training-explanations";
import {
  discardDecisionText,
  keepDecisionTextNow,
  saveDecisionTextNow,
  useChapterAutosave
} from "./useChapterAutosave";
import { studyEditShortcutLabels } from "./study-edit-shortcuts";
import { useStudyCommands } from "./useStudyCommands";
import { useStudyEditShortcuts } from "./useStudyEditShortcuts";

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
  stage = null,
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
  const queryClient = useQueryClient();
  const desktop = Boolean(window.chaturanga?.repertoires);
  const detail = useRepertoireQuery(repertoireId);
  const chapterQuery = useRepertoireChapterQuery(repertoireId, chapterId);
  const { flush } = useChapterAutosave();
  const commands = useStudyCommands(repertoireId);
  const { chapter, selectedNodeId, orientation, color, saveState, loadedId } =
    useRepertoireWorkspaceStore(
      useShallow((state) => ({
        chapter: state.chapter,
        selectedNodeId: state.selectedNodeId,
        orientation: state.orientation,
        color: state.color,
        saveState: state.saveState,
        loadedId:
          state.repertoireId === repertoireId && state.chapterId === chapterId
            ? state.chapterId
            : null
      }))
    );
  const draft = loadedId ? chapter : null;
  /** The line just deleted, with the undo step that brings it back (offered while it's the last). */
  const [deletedLine, setDeletedLine] = useState<{
    label: string;
    step: RepertoireChapter | undefined;
  } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  /**
   * The chapter the engine panel (Analyze) is open for: another chapter closes it, which stops
   * its search (as closing it or leaving Study does).
   */
  const [engineChapterId, setEngineChapterId] = useState<string | null>(null);
  const engineOpen = engineChapterId === chapterId;
  /** Set while this page removes the open chapter itself (not a "missing chapter" case). */
  const leavingChapter = useRef(false);
  const [mountedAt] = useState(() => Date.now());
  /** The chapter was read since this page opened (a cached tree may predate another write). */
  const chapterFresh = chapterQuery.dataUpdatedAt >= mountedAt && !chapterQuery.isFetching;

  // Load the chapter into the draft. A draft of this chapter with unsaved edits or a save error
  // is kept (coming back to it must not drop them); a clean one takes a newer stored revision.
  useEffect(() => {
    const loaded = detail.data;
    const stored = chapterQuery.data;
    if (!loaded || !stored || stored.id !== chapterId) return;
    const state = workspace();
    const same =
      state.repertoireId === repertoireId && state.chapterId === chapterId && state.chapter;
    if (same && (state.dirty || state.saveState.status !== "idle")) return;
    if (same && stored.revision <= state.chapter!.revision) {
      // The chapter is unchanged: a newer repertoire revision (another chapter, a decision)
      // doesn't conflict with this clean draft.
      state.adoptRevision(loaded.revision);
      return;
    }
    state.loadChapter(loaded, stored, {
      nodeId: same ? state.selectedNodeId : initialNodeId,
      orientation: same ? state.orientation : initialOrientation
    });
  }, [detail.data, chapterQuery.data, repertoireId, chapterId, initialNodeId, initialOrientation]);

  // History restore to the same chapter at another node.
  useEffect(() => {
    if (initialNodeId) workspace().selectNode(initialNodeId);
  }, [initialNodeId]);

  // A staged move (after the node selection above): added with its edge and selected (a reference
  // move leaves its decision selected), or marked when the chapter already has it (see stageMove). Applied once, and only on a chapter read
  // since this page opened, so it never edits a stale draft; the autosave saves it.
  useEffect(() => {
    if (!stage || !loadedId || !chapterFresh) return;
    const staged = workspace().stageMove(stage.nodeId, stage.uci, stage.edge);
    if (!staged) setLocalError("The game's move couldn't be added at this position.");
    onStageApplied?.();
  }, [stage, loadedId, chapterFresh, onStageApplied]);

  // The chapter opened after removing the open one is watched again (this runs before the check).
  useEffect(() => {
    leavingChapter.current = false;
  }, [chapterId]);

  // A read that failed because the repertoire or chapter was deleted, or for another reason (a
  // damaged chapter, a database error): only a deletion leaves the page.
  const detailError = detail.isError ? ipcErrorMessage(detail.error) : null;
  const chapterError = chapterQuery.isError ? ipcErrorMessage(chapterQuery.error) : null;
  const repertoireGone = detailError !== null && isNotFoundError(detailError, "repertoire");
  const chapterGone = chapterError !== null && isNotFoundError(chapterError, "chapter");
  const loadError = repertoireGone || chapterGone ? null : (detailError ?? chapterError);

  // Gone since: hand back to the hub with a reason.
  useEffect(() => {
    if (leavingChapter.current) return;
    if (repertoireGone) onMissing("That repertoire no longer exists.");
    else if (
      chapterGone ||
      (detail.data && !detail.data.chapters.some((item) => item.id === chapterId))
    ) {
      onMissing("That chapter no longer exists.");
    }
  }, [repertoireGone, chapterGone, detail.data, chapterId, onMissing]);

  /** Reads the repertoire and chapter again after a failure (the draft stays as it is). */
  const retryLoad = useEventCallback(() => {
    if (detail.isError) void detail.refetch();
    if (chapterQuery.isError) void chapterQuery.refetch();
  });

  useEffect(() => {
    if (draft) onPositionChanged();
  }, [draft, selectedNodeId, tab, orientation, onPositionChanged]);

  // Once per tree revision (design §11): selecting a node, editing edges/training marks or chapter
  // fields, and an autosave that returns the same tree (see reuseUnchangedTree) keep the lookup;
  // only new moves, comments or shapes (a changed tree) rebuild it.
  const tree = draft?.tree;
  const lookup = useMemo(() => (tree ? buildChapterLookup({ tree }) : null), [tree]);
  const node = lookup?.nodesById.get(selectedNodeId) ?? lookup?.nodesById.get("root") ?? null;
  const positionKey = lookup?.positionKeys.get(node?.id ?? "") ?? null;
  const storedDecision = useRepertoireDecisionQuery(repertoireId, positionKey);
  const sessionDecision = useRepertoireWorkspaceStore((state) =>
    positionKey ? (state.decisions[positionKey] ?? null) : null
  );
  // The stored decision is the truth; this session's last write only fills in while it loads.
  const decision = storedDecision.isSuccess ? storedDecision.data : sessionDecision;
  /** This repertoire's decision writes that failed (at any position). */
  const failedDrafts = useRepertoireWorkspaceStore(
    useShallow((state) =>
      Object.values(state.decisionDrafts).filter(
        (draft) => draft.repertoireId === repertoireId && draft.status === "error"
      )
    )
  );
  const occurrences = useRepertoireOccurrencesQuery(repertoireId, positionKey);
  const otherOccurrences = useMemo(
    () => occurrencesInOtherChapters(occurrences.data ?? [], chapterId),
    [occurrences.data, chapterId]
  );
  const choices = useMemo(
    () => (draft && lookup && node ? deriveChoices(draft, lookup, node.id, color, decision) : null),
    [draft, lookup, node, color, decision]
  );
  const training = useMemo(
    () => (draft && lookup ? chapterTraining(color, draft, lookup) : null),
    [draft, lookup, color]
  );
  const decisionCount = training?.decisionKeys.length ?? 0;
  const pausedKeys = useRepertoirePausedKeysQuery(repertoireId).data;
  const paused = useMemo(() => new Set(pausedKeys ?? []), [pausedKeys]);
  // "Rehearse from here" is offered in training scope within the default depth limit only, where
  // a line asks a decision that isn't paused (a paused one is played as context).
  const rehearsal = useMemo(
    () =>
      draft && lookup && draft.enabled && draft.kind === "opening"
        ? rehearsalContext(draft, color, DEFAULT_REHEARSAL_DEPTH_PLIES, lookup, paused)
        : null,
    [draft, lookup, color, paused]
  );
  const availability = useMemo(
    () =>
      studyPracticeAvailability({
        blocker:
          training?.blocker && lookup && draft
            ? blockerExplanation(training.blocker, draft.title, lookup, color)
            : null,
        decisionKeys: training?.decisionKeys ?? [],
        paused,
        rehearsableLines: rehearsal ? lineEnds(rehearsal, REPERTOIRE_ROOT_NODE_ID).length : 0
      }),
    [training, lookup, draft, color, paused, rehearsal]
  );
  const practiceReasonId = useId();
  const onlineGameLive = useLichessStore(selectLiveGameInProgress);

  /**
   * "Include in practice" waiting on the player: it would add moves at positions other chapters
   * answer differently (the question, for this chapter), with what it read of the repertoire for
   * the chapter as it was at `generation`.
   */
  const [widening, setWidening] = useState<{
    chapterId: string;
    generation: number;
    question: string;
    acceptedAt: AcceptedAt;
  } | null>(null);
  const [including, setIncluding] = useState(false);
  // Reads what the other chapters practise where it accepts moves, so it accepts those moves
  // there; asks first when it would still add one where they practise another. The plan is for
  // the chapter as it is when it applies (currentIncludePlan).
  const includeInPractice = useEventCallback(async () => {
    setLocalError(null);
    setWidening(null);
    setIncluding(true);
    try {
      const plan = await currentIncludePlan(
        color,
        () => {
          const { chapter, chapterId: open, generation } = workspace();
          return chapter && open === chapterId ? { chapter, generation } : null;
        },
        (keys) => fetchPractisedElsewhere(repertoireId, chapterId, keys)
      );
      if (!plan) return;
      if (plan.widened.length) {
        setWidening({
          chapterId,
          generation: plan.generation,
          question: wideningQuestion(buildChapterLookup({ tree: plan.chapter.tree }), plan.widened),
          acceptedAt: plan.acceptedAt
        });
      } else {
        workspace().makeChapterTrainable(plan.acceptedAt);
      }
    } catch (error) {
      setLocalError(`Couldn't include the chapter in practice: ${ipcErrorMessage(error)}`);
    } finally {
      setIncluding(false);
    }
  });
  // A chapter edited since the question was asked is planned (and asked about) again.
  const confirmWidening = useEventCallback(() => {
    const asked = widening;
    setWidening(null);
    if (asked?.chapterId !== chapterId) return;
    if (workspace().generation === asked.generation) {
      workspace().makeChapterTrainable(asked.acceptedAt);
    } else {
      void includeInPractice();
    }
  });

  const selectNode = useEventCallback((nodeId: string) => workspace().selectNode(nodeId));
  useTreeKeyboardNavigation({
    enabled: Boolean(draft),
    nodes: draft?.tree ?? [],
    selectedNodeId,
    onSelect: selectNode
  });

  const onMove = useEventCallback((uci: string, san: string, fenAfter: string) => {
    workspace().playMove(uci, san, fenAfter);
  });
  const onShapesChange = useEventCallback((arrows: BoardArrow[], highlights: BoardHighlight[]) => {
    const id = workspace().selectedNodeId;
    workspace().setShapes(id, arrows, highlights);
  });
  const onDeleteLine = useEventCallback((nodeId: string) => {
    const label = lookup ? pathLabel(lookup, nodeId) : "";
    if (workspace().deleteLine(nodeId)) {
      setDeletedLine({ label, step: workspace().undoStack.at(-1) });
    }
  });
  const promoteVariation = useEventCallback((nodeId: string) => {
    workspace().promoteVariation(nodeId);
  });
  const lastUndo = useRepertoireWorkspaceStore((state) => state.undoStack.at(-1));
  const canRedo = useRepertoireWorkspaceStore((state) => state.redoStack.length > 0);
  const canPromote = useMemo(
    () => Boolean(draft && promotionTarget(draft.tree, selectedNodeId)),
    [draft, selectedNodeId]
  );
  const editLabels = studyEditShortcutLabels(isElectronMac());
  useStudyEditShortcuts({
    enabled: Boolean(draft),
    onAction: (action) => {
      if (action === "undo") workspace().undo();
      else if (action === "redo") workspace().redo();
      else workspace().promoteVariation(workspace().selectedNodeId);
    }
  });
  const practiceChapter = useEventCallback(async () => {
    setLocalError(null);
    if (await flush()) onPractice([chapterId]);
    else setLocalError("This chapter isn't saved yet — retry the save before practising.");
  });

  const rehearse = useEventCallback(async (fromNodeId: string | null) => {
    if (!onRehearse) return;
    setLocalError(null);
    if (await flush()) {
      onRehearse({ chapterId, ...(fromNodeId ? { fromNodeId } : {}) });
    } else setLocalError("This chapter isn't saved yet — retry the save before rehearsing.");
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

  const changeDecisionText = useEventCallback((field: DecisionTextField, text: string) => {
    if (positionKey) workspace().setDecisionText(repertoireId, positionKey, field, text);
  });
  // Blur (or Add / Remove / the pause switch): a draft matching the stored decision is dropped;
  // any other is written now. One whose write is still running is marked to be written again
  // once that write settles (with what was typed meanwhile). A stale one waits for Discard /
  // Keep mine.
  const commitDecisionDraft = useEventCallback((key: string) => {
    const draft = workspace().decisionDrafts[key];
    if (!draft) return;
    if (draft.status === "saving") {
      workspace().requestDecisionTextSaveAgain(key);
      return;
    }
    if (draft.status === "pending" && decisionDraftMatches(draft, decision)) {
      workspace().discardDecisionText(key);
      return;
    }
    void saveDecisionTextNow(queryClient, key);
  });
  const commitDecisionText = useEventCallback((field: DecisionTextField) => {
    if (positionKey) commitDecisionDraft(decisionDraftKey(repertoireId, positionKey, field));
  });
  const changeFeedback = useEventCallback((uci: string, text: string) => {
    if (positionKey) workspace().setWrongMoveFeedback(repertoireId, positionKey, uci, text);
  });
  const commitFeedback = useEventCallback((uci: string) => {
    if (positionKey) {
      commitDecisionDraft(decisionDraftKey(repertoireId, positionKey, "feedback", uci));
    }
  });
  const setPaused = useEventCallback((paused: boolean) => {
    if (!positionKey) return;
    workspace().setDecisionPaused(repertoireId, positionKey, paused);
    commitDecisionDraft(decisionDraftKey(repertoireId, positionKey, "paused"));
  });

  const reload = useEventCallback(async () => {
    const [nextDetail, nextChapter] = await Promise.all([detail.refetch(), chapterQuery.refetch()]);
    if (nextDetail.data && nextChapter.data) {
      workspace().loadChapter(nextDetail.data, nextChapter.data, {
        nodeId: workspace().selectedNodeId,
        orientation: workspace().orientation
      });
    }
  });
  const keepEditing = useEventCallback(async () => {
    const [nextDetail, nextChapter] = await Promise.all([detail.refetch(), chapterQuery.refetch()]);
    if (nextDetail.data) {
      const stored = nextChapter.data?.id === workspace().chapterId ? nextChapter.data : null;
      workspace().adoptRevision(nextDetail.data.revision, stored?.revision);
    }
    workspace().clearSaveError();
  });

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

  if ((!draft || !lookup || !node) && loadError !== null) {
    return (
      <EmptyState
        className="self-center"
        icon={<CircleAlert />}
        title="This chapter couldn't be opened"
        description={loadError}
        action={
          <div className="flex gap-2">
            <Button type="button" variant="primary" size="sm" onClick={retryLoad}>
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

  if (!draft || !lookup || !node) {
    return (
      <div className="grid place-items-center" role="status" aria-label="Loading chapter">
        <Loader2 className="size-5 animate-spin text-fg-subtle" />
      </div>
    );
  }

  /** The player is to move here with at least one accepted move (a decision exists). */
  const canEditDecision = Boolean(
    choices?.side === "player" &&
    choices.rows.some((row) => row.state === "preferred" || row.state === "accepted")
  );

  // Why Play from here can't start (it also waits for the chapter to load, above). A study action:
  // a chapter left out of practice is still played from.
  // The engine panel too, while closed (open, it says so itself and can always be closed).
  const positionOver = statusForFen(node.fenAfter).isEnd;
  const handoffUnavailable = positionOver
    ? NO_MOVES_TO_PLAY
    : onlineGameLive
      ? LIVE_GAME_NOTICE
      : null;
  const analyzeUnavailable = positionOver
    ? NO_MOVES_TO_PLAY
    : onlineGameLive
      ? "The engine is off during your Lichess game."
      : null;

  const removeChapter = async (id: string) => {
    const current = id === chapterId;
    if (current) leavingChapter.current = true;
    const repertoire = await commands.removeChapter(id);
    if (!current) return;
    if (!repertoire) {
      // Not removed (the error shows in the panel): stay on it.
      leavingChapter.current = false;
      return;
    }
    // The removed chapter's draft must never be saved again (that would recreate it).
    workspace().reset();
    const next = sortedChapters(repertoire.chapters)[0];
    if (next) onOpenChapter(next.id);
    else onMissing("The chapter was removed.");
  };

  const errorNotice =
    saveState.status === "error" ? (
      <Notice
        tone={saveState.stale ? "warn" : "danger"}
        title={saveState.stale ? "This repertoire changed elsewhere" : "Couldn't save the chapter"}
        action={
          <div className="flex gap-2">
            {saveState.stale ? (
              <>
                <Button type="button" variant="outline" size="xs" onClick={() => void reload()}>
                  Reload
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  title="Keep your draft; the next save replaces the newer version"
                  onClick={() => void keepEditing()}
                >
                  Keep editing
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => workspace().clearSaveError()}
              >
                Retry
              </Button>
            )}
          </div>
        }
      >
        {saveState.stale
          ? "Reload to see the saved version (your unsaved edits are dropped), or keep editing to save yours over it."
          : saveState.message}
      </Notice>
    ) : null;

  const decisionNotices = failedDrafts.map((failed: DecisionTextDraft) => {
    const key = decisionDraftKey(failed.repertoireId, failed.positionKey, failed.field, failed.uci);
    const stale = Boolean(failed.error?.stale);
    // Its move was undone or its line deleted: kept for when the move comes back.
    const missing = Boolean(failed.error?.missing);
    // Where it was typed, when this chapter reaches that position.
    const at = [...lookup.positionKeys].find(([, keyAt]) => keyAt === failed.positionKey);
    const where = at ? ` at ${pathLabel(lookup, at[0])}` : "";
    const fenAt = at ? lookup.nodesById.get(at[0])?.fenAfter : undefined;
    const name = decisionDraftName(
      failed,
      fenAt && failed.uci ? playUci(fenAt, failed.uci)?.san : undefined
    );
    return (
      <Notice
        key={key}
        tone={stale ? "warn" : "danger"}
        title={
          stale
            ? "This repertoire changed elsewhere"
            : missing
              ? `The ${name} has no position to be saved at`
              : `Couldn't save the ${name}${where}`
        }
        action={
          <div className="flex gap-2">
            {stale ? (
              <Button
                type="button"
                variant="outline"
                size="xs"
                title={`Save your ${name} over the newer version`}
                onClick={() => void keepDecisionTextNow(queryClient, key)}
              >
                Keep mine
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => void saveDecisionTextNow(queryClient, key)}
              >
                Retry
              </Button>
            )}
            <Button
              type="button"
              variant="link"
              size="xs"
              title={`Drop the typed ${name}; the saved one shows again`}
              onClick={() => discardDecisionText(queryClient, key)}
            >
              Discard
            </Button>
          </div>
        }
      >
        {stale
          ? `Your ${name}${where} wasn't saved. Discard it to see the saved version, or keep yours to save it over that.`
          : missing
            ? `${failed.error?.message} Your ${name} is kept: put the move back (Redo) and retry, or discard it.`
            : failed.error?.message}
      </Notice>
    );
  });

  const notices = (
    <>
      {errorNotice}
      {decisionNotices}
      {loadError !== null ? (
        <Notice
          tone="danger"
          title="Couldn't read this repertoire again"
          action={
            <Button type="button" variant="outline" size="xs" onClick={retryLoad}>
              Retry
            </Button>
          }
        >
          {`${loadError} Your draft is kept.`}
        </Notice>
      ) : null}
      {commands.error || localError ? (
        <Notice
          tone="danger"
          action={
            <Button
              type="button"
              variant="link"
              size="xs"
              onClick={() => {
                commands.clearError();
                setLocalError(null);
              }}
            >
              Dismiss
            </Button>
          }
        >
          {commands.error ?? localError}
        </Notice>
      ) : null}
      {deletedLine !== null && deletedLine.step === lastUndo ? (
        <Notice
          tone="info"
          action={
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => {
                  workspace().undo();
                  setDeletedLine(null);
                }}
              >
                Undo
              </Button>
              <Button type="button" variant="link" size="xs" onClick={() => setDeletedLine(null)}>
                Dismiss
              </Button>
            </div>
          }
        >
          Deleted the line from {deletedLine.label}.
        </Notice>
      ) : null}
    </>
  );

  // Under the notices and above the tab, so the moves stay in view while the engine runs.
  const enginePanel = engineOpen ? (
    <StudyEnginePanel
      id={enginePanelId}
      chapter={draft}
      node={node}
      orientation={orientation}
      onClose={() => setEngineChapterId(null)}
      onOpenSettings={onOpenEngineSettings}
    />
  ) : null;

  const turn: Color = node.fenAfter.split(" ")[1] === "b" ? "black" : "white";

  return (
    <BoardWorkspace
      panelLabel="Repertoire study"
      tabPanel={tabPanelProps(panelId, tab)}
      board={
        <BoardStage
          evalBar={
            engineOpen ? <StudyEvalBar fen={node.fenAfter} orientation={orientation} /> : undefined
          }
          top={
            <p className="flex h-8 min-w-0 items-center gap-2 text-sm text-fg-secondary">
              <SideDot color={color} />
              <span className="truncate">
                {COLOR_LABELS[color]} repertoire · {draft.title}
              </span>
            </p>
          }
          bottom={
            <p
              className="flex h-8 min-w-0 items-center truncate font-mono text-xs text-fg-muted"
              title={pathLabel(lookup, node.id)}
            >
              {pathLabel(lookup, node.id)}
            </p>
          }
        >
          <ControlledBoard
            fen={node.fenAfter}
            orientation={orientation}
            movable="both"
            lastMove={lastMoveOf(node.uci)}
            arrows={node.arrows}
            highlights={node.highlights}
            onShapesChange={onShapesChange}
            onMove={onMove}
          />
        </BoardStage>
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
          <StatGroup className="min-w-0 flex-1 auto-cols-[minmax(0,max-content)] gap-5">
            <Stat
              label="To move"
              value={
                <span className="inline-flex items-center gap-2">
                  <SideDot color={turn} />
                  {choices?.side === "player" ? "You" : "Opponent"}
                </span>
              }
            />
            <Stat label="Decisions" value={`${decisionCount} in this chapter`} />
          </StatGroup>
          <StudyPositionActions
            engineOpen={engineOpen}
            enginePanelId={enginePanelId}
            analyzeUnavailable={analyzeUnavailable}
            onToggleEngine={() => setEngineChapterId(engineOpen ? null : chapterId)}
            playUnavailable={handoffUnavailable}
            onPlayFromHere={onPlayFromHere}
          />
        </div>
      }
      notices={
        <>
          {notices}
          {enginePanel}
        </>
      }
      footer={
        <>
          <RepertoireMoveNavigation
            nodes={draft.tree}
            selectedNodeId={node.id}
            onSelect={selectNode}
          />
          {/* The status line wraps (never cut off); the chapter's two actions share one row, their
              labels shortened in a narrow panel (the names stay whole for assistive tech). */}
          <div className="grid gap-2 border-t border-line-subtle px-3 py-2">
            <p id={practiceReasonId} className="text-2xs leading-4 text-fg-subtle">
              {availability.practice ??
                availability.rehearse ??
                "Play a move on the board to add a variation."}
            </p>
            <div className={cn("grid gap-2", onRehearse && "grid-cols-2")}>
              {onRehearse ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Rehearse this chapter"
                  title={
                    availability.rehearse ??
                    "Play your moves along this chapter's lines, with the replies supplied"
                  }
                  disabled={availability.rehearse !== null}
                  aria-describedby={availability.rehearse ? practiceReasonId : undefined}
                  onClick={() => void rehearse(null)}
                >
                  <Route />
                  <span>
                    Rehearse<span className="hidden @[26rem]/panel:inline"> this chapter</span>
                  </span>
                </Button>
              ) : null}
              <Button
                type="button"
                variant="primary"
                size="sm"
                aria-label="Practice this chapter"
                title={availability.practice ?? "Practise this chapter's decisions"}
                disabled={availability.practice !== null}
                aria-describedby={availability.practice ? practiceReasonId : undefined}
                onClick={() => void practiceChapter()}
              >
                <GraduationCap />
                <span>
                  Practice<span className="hidden @[26rem]/panel:inline"> this chapter</span>
                </span>
              </Button>
            </div>
          </div>
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
          {training?.blocker ? (
            <StudyTrainingNotice
              blocker={training.blocker}
              chapterTitle={draft.title}
              lookup={lookup}
              color={color}
              selectedNodeId={node.id}
              busy={commands.busy || including}
              widening={widening?.chapterId === chapterId ? widening.question : null}
              onMakeTrainable={() => void includeInPractice()}
              onConfirmWidening={confirmWidening}
              onCancelWidening={() => setWidening(null)}
              onSetMeta={(nodeId, patch) => workspace().setNodeMeta(nodeId, patch)}
              onSelectNode={selectNode}
            />
          ) : null}
          {/* About three rows of moves at least, also under the engine panel (the tab scrolls on to the choices). */}
          <section className="flex max-h-[45%] min-h-40 shrink-0 flex-col" aria-label="Moves">
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
                  disabled={!lastUndo}
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
                onClick={() => promoteVariation(node.id)}
              >
                <ArrowUpToLine />
                Promote variation
              </Button>
            </div>
            <StudyTree
              key={chapterId}
              lookup={lookup}
              selectedNodeId={node.id}
              onSelectNode={selectNode}
              onDeleteLine={onDeleteLine}
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
            onRehearseFromHere={
              onRehearse && rehearsal && canRehearseFrom(rehearsal, node.id)
                ? () => void rehearse(node.id)
                : undefined
            }
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
          onDecisionTextChange={changeDecisionText}
          onCommitDecisionText={commitDecisionText}
          decisionControls={
            choices?.side === "player" ? (
              <StudyDecisionPractice
                // A move and text picked for "Add feedback" belong to this position only.
                key={positionKey ?? ""}
                repertoireId={repertoireId}
                positionKey={positionKey}
                fen={node.fenAfter}
                decision={decision}
                canEditDecision={canEditDecision}
                busy={commands.busy}
                onFeedbackChange={changeFeedback}
                onCommitFeedback={commitFeedback}
                onSetPaused={setPaused}
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
