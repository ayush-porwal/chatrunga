import { useEffect, useId, useMemo, useRef, useState } from "react";
import { GraduationCap, Loader2, Microscope, Swords } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { statusForFen } from "@chaturanga/shared/chess/position";
import { buildChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import type { BoardArrow, BoardHighlight, Color } from "@chaturanga/shared/types/chess";
import type { RepertoireChapterSummary } from "@chaturanga/shared/types/repertoire";
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
import { useEventCallback } from "@/lib/use-event-callback";
import {
  useRepertoireChapterQuery,
  useRepertoireDecisionQuery,
  useRepertoireOccurrencesQuery,
  useRepertoireQuery
} from "../../queries/repertoire";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { BoardStage, BoardWorkspace, workspaceTabsClass } from "../board/BoardWorkspace";
import { ControlledBoard } from "../board/ControlledBoard";
import { TreeView } from "../game/TreeView";
import {
  COLOR_LABELS,
  nextSortOrder,
  sortedChapters,
  type StudyStage
} from "./repertoire-chapters";
import {
  deriveChoices,
  occurrencesInOtherChapters,
  lastMoveOf,
  pathLabel,
  trainableDecisionCount
} from "./repertoire-model";
import { RepertoireMoveNavigation, useTreeKeyboardNavigation } from "./RepertoireMoveNavigation";
import { NO_MOVES_TO_PLAY } from "./handoffs";
import { StudyChaptersPanel } from "./StudyChaptersPanel";
import { StudyChoicesPanel } from "./StudyChoicesPanel";
import { StudyNotesPanel } from "./StudyNotesPanel";
import { StudySourcesSection } from "./StudySourcesSection";
import { useChapterAutosave } from "./useChapterAutosave";
import { useStudyCommands } from "./useStudyCommands";

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
 * store. A chapter or repertoire that no longer exists hands back to the hub (`onMissing`).
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
  onMissing,
  onPositionChanged,
  onOpenGame,
  onAnalyze,
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
  onMissing: (message: string) => void;
  /** The selected node, tab or orientation changed (the current history entry follows). */
  onPositionChanged: () => void;
  /** A source link's saved game, opened on the board at the linked move. */
  onOpenGame?: (gameId: string, nodeId: string | null) => void;
  /**
   * "Analyze": the route to the selected node as a new unsaved game on the analysis board. App
   * saves the draft first (and offers Retry when it can't); Back returns here.
   */
  onAnalyze?: () => void;
  /** "Play from here": an engine game from the selected position, as the repertoire's colour. */
  onPlayFromHere?: () => void;
}) {
  const panelId = useId();
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
  const [deletedLine, setDeletedLine] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
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

  // Gone since: hand back to the hub with a reason.
  useEffect(() => {
    if (leavingChapter.current) return;
    if (detail.isError) onMissing("That repertoire no longer exists.");
    else if (detail.data && !detail.data.chapters.some((item) => item.id === chapterId)) {
      onMissing("That chapter no longer exists.");
    } else if (chapterQuery.isError) onMissing("That chapter couldn't be opened.");
  }, [detail.isError, detail.data, chapterQuery.isError, chapterId, onMissing]);

  useEffect(() => {
    if (draft) onPositionChanged();
  }, [draft, selectedNodeId, tab, orientation, onPositionChanged]);

  const lookup = useMemo(() => (draft ? buildChapterLookup(draft) : null), [draft]);
  const node = lookup?.nodesById.get(selectedNodeId) ?? lookup?.nodesById.get("root") ?? null;
  const positionKey = lookup?.positionKeys.get(node?.id ?? "") ?? null;
  const storedDecision = useRepertoireDecisionQuery(repertoireId, positionKey);
  const sessionDecision = useRepertoireWorkspaceStore((state) =>
    positionKey ? (state.decisions[positionKey] ?? null) : null
  );
  // The stored decision is the truth; this session's last write only fills in while it loads.
  const decision = storedDecision.isSuccess ? storedDecision.data : sessionDecision;
  const occurrences = useRepertoireOccurrencesQuery(repertoireId, positionKey);
  const otherOccurrences = useMemo(
    () => occurrencesInOtherChapters(occurrences.data ?? [], chapterId),
    [occurrences.data, chapterId]
  );
  const choices = useMemo(
    () => (draft && lookup && node ? deriveChoices(draft, lookup, node.id, color, decision) : null),
    [draft, lookup, node, color, decision]
  );
  const decisionCount = useMemo(
    () => (draft ? trainableDecisionCount(color, draft) : 0),
    [draft, color]
  );

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
    if (workspace().deleteLine(nodeId)) setDeletedLine(label);
  });
  const practiceChapter = useEventCallback(async () => {
    setLocalError(null);
    if (await flush()) onPractice([chapterId]);
    else setLocalError("This chapter isn't saved yet — retry the save before practising.");
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

  if (!draft || !lookup || !node) {
    return (
      <div className="grid place-items-center" role="status" aria-label="Loading chapter">
        <Loader2 className="size-5 animate-spin text-fg-subtle" />
      </div>
    );
  }

  // Why Analyze and Play from here can't start (they also wait for the chapter to load, above).
  const handoffUnavailable = !draft.enabled
    ? "Enable this chapter to analyse or play from it"
    : statusForFen(node.fenAfter).isEnd
      ? NO_MOVES_TO_PLAY
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

  const notices = (
    <>
      {errorNotice}
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
      {deletedLine !== null ? (
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
          Deleted the line from {deletedLine}.
        </Notice>
      ) : null}
    </>
  );

  const turn: Color = node.fenAfter.split(" ")[1] === "b" ? "black" : "white";

  return (
    <BoardWorkspace
      panelLabel="Repertoire study"
      tabPanel={tabPanelProps(panelId, tab)}
      board={
        <BoardStage
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
            keyboardInput
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
        <StatGroup className="w-full">
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
      }
      notices={notices}
      footer={
        <>
          <RepertoireMoveNavigation
            nodes={draft.tree}
            selectedNodeId={node.id}
            onSelect={selectNode}
          />
          {/* Wraps in a narrow side panel: the three actions must never widen it (it would scroll sideways). */}
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-t border-line-subtle px-3 py-2">
            <p className="min-w-0 flex-1 basis-32 truncate text-2xs text-fg-subtle">
              Play a move on the board to add a variation.
            </p>
            <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
              {onAnalyze ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  title={
                    handoffUnavailable ??
                    "Explore this position on the analysis board (a copy; the chapter stays as it is)"
                  }
                  disabled={handoffUnavailable !== null}
                  onClick={onAnalyze}
                >
                  <Microscope />
                  Analyze
                </Button>
              ) : null}
              {onPlayFromHere ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  title={
                    handoffUnavailable ??
                    "Play the engine from this position as your repertoire's side"
                  }
                  disabled={handoffUnavailable !== null}
                  onClick={onPlayFromHere}
                >
                  <Swords />
                  Play from here
                </Button>
              ) : null}
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={!draft.enabled || draft.kind !== "opening"}
                onClick={() => void practiceChapter()}
              >
                <GraduationCap />
                Practice this chapter
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
          <section className="flex max-h-[45%] min-h-32 shrink-0 flex-col" aria-label="Moves">
            <TreeView
              nodes={draft.tree}
              selectedNodeId={node.id}
              onSelectNode={selectNode}
              onDeleteLine={onDeleteLine}
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
          />
        </div>
      ) : null}
      {tab === "notes" ? (
        <StudyNotesPanel
          key={`${node.id}:${positionKey}:${decision?.prompt ?? ""}:${decision?.hint ?? ""}`}
          node={node}
          decisionText={decision}
          canEditDecision={Boolean(
            choices?.side === "player" &&
            choices.rows.some((row) => row.state === "preferred" || row.state === "accepted")
          )}
          busy={commands.busy}
          onComment={(text) => workspace().setComment(node.id, text)}
          onSaveDecisionText={(field, text) =>
            positionKey ? commands.writeDecision(positionKey, { [field]: text }) : undefined
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
