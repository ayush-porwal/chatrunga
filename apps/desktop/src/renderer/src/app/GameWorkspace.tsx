import { memo, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { BookPlus, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEnginesQuery } from "../queries/api";
import { AnalysisSettingsDialog } from "../features/analysis/AnalysisSettingsDialog";
import { useShallow } from "zustand/react/shallow";
import { AnnotationBadge } from "@/components/ui/annotation-badge";
import {
  SegmentedControl,
  tabPanelProps,
  type SegmentedOption
} from "@/components/ui/segmented-control";
import { SideDot } from "@/components/ui/side-dot";
import { Stat, StatGroup } from "@/components/ui/stat";
import { positionStatus } from "@/lib/position-status";
import { BoardView } from "../features/board/BoardView";
import { BoardWorkspace, workspaceTabsClass } from "../features/board/BoardWorkspace";
import { MoveNavigation } from "../features/board/MoveNavigation";
import { EngineStatusPanel } from "../features/analysis/EngineStatusPanel";
import { MoveList } from "../features/game/MoveList";
import { RecentGames } from "../features/game/RecentGames";
import { mainlineReviewInput } from "../features/game-review/review-utils";
import { ReviewCharts } from "../features/game-review/ReviewCharts";
import { KeyMomentNav } from "../features/game-review/KeyMoments";
import { reviewSideColor, useReviewSide } from "../features/game-review/review-side";
import { moverOf } from "../features/game-review/review-summary";
import { keyMoments } from "@chaturanga/shared/chess/key-moments";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import { formatMoveEval } from "../features/game-review/review-score";
import { hasMoves } from "../features/repertoire/add-from-game";
import { ADD_NEEDS_SAVE, captureBoardSource } from "../features/repertoire/board-source";
import { useAddToRepertoireStore } from "../stores/add-to-repertoire-store";
import { useAppNoticeStore } from "../stores/app-notice-store";
import { useGameStore } from "../stores/game-store";
import { usePuzzleStore } from "../stores/puzzle-store";
import { useReviewStore } from "../stores/review-store";
import { useDisplayedReviewMoves } from "../stores/review-validity";
import { availableSideTab, type PuzzleTabs, type SideTab } from "./side-tabs";

const sideTabOptions: readonly SegmentedOption<SideTab>[] = [
  { value: "notation", label: "Moves" },
  { value: "engine", label: "Engine" },
  { value: "library", label: "Library" }
];

/** A puzzle has no Library; its Engine tab is locked until the puzzle is solved or failed (it would give the answer away). */
const puzzleTabOptions: readonly SegmentedOption<SideTab>[] = [
  { value: "notation", label: "Moves" },
  { value: "engine", label: "Engine" }
];
const lockedPuzzleTabOptions: readonly SegmentedOption<SideTab>[] = [
  { value: "notation", label: "Moves" },
  {
    value: "engine",
    label: "Engine",
    disabled: true,
    disabledReason: "Available after the puzzle is solved or failed"
  }
];

function usePuzzleTabs(): PuzzleTabs {
  const puzzleBoard = useGameStore((state) => state.source === "puzzle");
  return usePuzzleStore((state) =>
    !puzzleBoard || !state.activePuzzle ? "none" : state.outcome === "pending" ? "locked" : "open"
  );
}

/**
 * The game view (free board, Analysis, engine and Lichess games, Puzzle) rendered through the shared board
 * workspace — same geometry as Game review. Tabs: Moves · Engine · Library (the puzzle card sits
 * atop Moves; a puzzle has no Library, and its Engine tab opens once it's solved or failed).
 * Footer: eval graph when the game has been reviewed, then move navigation.
 */
export const GameWorkspace = memo(function GameWorkspace({
  onOpenGame,
  sideTab,
  onSideTabChange,
  puzzlePanel,
  onStartAnalysis,
  onStopAnalysis,
  onOpenSettings
}: {
  /** Library tab: open a saved game on the board. */
  onOpenGame: (id: string) => void;
  sideTab: SideTab;
  onSideTabChange: (tab: SideTab) => void;
  puzzlePanel: ReactNode;
  onStartAnalysis?: () => void;
  onStopAnalysis?: () => void;
  onOpenSettings?: () => void;
}) {
  // The per-move parts (board, summary, footer) subscribe on their own, so stepping through the
  // game re-renders them and not the whole workspace (tabs, panel, puzzle card).
  const panelId = useId();
  const puzzleTabs = usePuzzleTabs();
  const shownTab = availableSideTab(sideTab, puzzleTabs);
  // A tab the puzzle doesn't offer (Library, or Engine while locked) is never kept as the stored one.
  useEffect(() => {
    if (shownTab !== sideTab) onSideTabChange(shownTab);
  }, [onSideTabChange, shownTab, sideTab]);
  return (
    <BoardWorkspace
      tabPanel={tabPanelProps(panelId, shownTab)}
      panelLabel="Game"
      board={boardView}
      tabs={
        <SegmentedControl
          ariaLabel="Workspace panels"
          role="tablist"
          panelId={panelId}
          fullWidth
          className={workspaceTabsClass}
          value={shownTab}
          onChange={onSideTabChange}
          options={
            puzzleTabs === "none"
              ? sideTabOptions
              : puzzleTabs === "locked"
                ? lockedPuzzleTabOptions
                : puzzleTabOptions
          }
        />
      }
      summary={
        shownTab === "engine" ? (
          <EngineTabSummary onStartAnalysis={onStartAnalysis} onStopAnalysis={onStopAnalysis} />
        ) : (
          gameSummary
        )
      }
      footer={gameFooter}
    >
      {shownTab === "notation" ? (
        // A puzzle card taller than the panel (a short window, an explanation) scrolls with the
        // moves rather than running under the footer.
        <div className="scroll-area -mr-3 flex h-full min-h-0 flex-col gap-3 overflow-y-auto pr-3">
          {puzzlePanel}
          <section className="flex min-h-40 flex-1 flex-col" aria-label="Moves">
            <MoveList />
          </section>
          {/* A puzzle isn't saved, so it can't be added to a repertoire. */}
          {puzzleTabs === "none" ? addToRepertoireButton : null}
        </div>
      ) : null}
      {shownTab === "engine" ? (
        <div className="scroll-area -mr-3 h-full min-h-0 overflow-y-auto pr-3">
          <EngineStatusPanel onOpenSettings={onOpenSettings} />
        </div>
      ) : null}
      {shownTab === "library" ? <RecentGames onOpenGame={onOpenGame} /> : null}
    </BoardWorkspace>
  );
});

/** Result or side to move, plus the review verdict for the current move once the game is reviewed. */
function GameSummary() {
  const position = useGameStore(
    useShallow((state) => {
      const status = positionStatus(state.currentFen);
      return {
        turn: status.turn,
        isEnd: status.isEnd,
        result: status.result,
        isCheckmate: status.isCheckmate,
        isStalemate: status.isStalemate
      };
    })
  );
  const gameOutcome = useGameStore((state) => state.gameOutcome);
  const currentNodeId = useGameStore((state) => state.currentNodeId);
  const reviewMoves = useDisplayedReviewMoves();
  const currentMoveReview = useMemo(
    () => reviewMoves.find((move) => move.nodeId === currentNodeId) ?? null,
    [currentNodeId, reviewMoves]
  );

  const ended = Boolean(gameOutcome) || position.isEnd;
  const result = gameOutcome?.result ?? position.result;
  const termination =
    gameOutcome?.termination ??
    (position.isCheckmate ? "checkmate" : position.isStalemate ? "stalemate" : null);

  return (
    <StatGroup className="w-full">
      {ended ? (
        <Stat
          label="Result"
          value={termination ? `${result} · ${terminationLabel(termination)}` : result}
        />
      ) : (
        <Stat
          label="To move"
          value={
            <span className="inline-flex items-center gap-2">
              <SideDot color={position.turn} />
              {position.turn === "white" ? "White" : "Black"}
            </span>
          }
        />
      )}
      {currentMoveReview ? (
        <>
          <Stat
            label="Move"
            value={
              currentMoveReview.assessment?.annotation ? (
                <AnnotationBadge annotation={currentMoveReview.assessment.annotation} />
              ) : (
                <span className="text-fg-subtle">No mark</span>
              )
            }
          />
          <Stat label="Eval" value={formatMoveEval(currentMoveReview)} mono />
        </>
      ) : null}
    </StatGroup>
  );
}

/**
 * The Charts section (as Game review's) for the loaded game, then move navigation. It shows what
 * the game has: winning chances (and difficulty, when its review ran Maia) from a review of it,
 * time per move from its clocks. On the Analyze board it shows for any game with moves; elsewhere
 * (play, puzzles) only once the game has a review.
 */
function GameFooter() {
  const currentNodeId = useGameStore((state) => state.currentNodeId);
  const moveTree = useGameStore((state) => state.moveTree);
  const orientation = useGameStore((state) => state.orientation);
  const timeControl = useGameStore((state) => state.headers.timeControl);
  const analysisMode = useGameStore((state) => state.mode === "analysis");
  const goToNode = useGameStore((state) => state.goToNode);
  const reviewStatus = useReviewStore((state) => state.status);
  const review = useReviewStore((state) => state.review);
  const reviewMoves = useDisplayedReviewMoves();
  const mainline = useMemo(() => mainlineReviewInput(moveTree), [moveTree]);
  const onMainline = useMemo(
    () => currentNodeId === "root" || mainline.some((move) => move.nodeId === currentNodeId),
    [currentNodeId, mainline]
  );
  // Only use the review when it belongs to the loaded game.
  const hasReview = useMemo(() => {
    if (!reviewMoves.length) return false;
    const nodeIds = new Set(moveTree.map((node) => node.id));
    return reviewMoves.every((move) => nodeIds.has(move.nodeId));
  }, [moveTree, reviewMoves]);
  const moves = hasReview ? reviewMoves : EMPTY_REVIEW_MOVES;
  const reviewRunning = reviewStatus === "running";
  const side = reviewSideColor(useReviewSide(orientation));
  // The reviewed side's key insights, once a finished review has them.
  const moments = useMemo(
    () =>
      hasReview && !reviewRunning ? keyMoments(moves.filter((move) => moverOf(move) === side)) : [],
    [hasReview, moves, reviewRunning, side]
  );
  const momentIds = useMemo(() => new Set(moments.map((moment) => moment.nodeId)), [moments]);
  const selectedPly = moveTree.find((node) => node.id === currentNodeId)?.ply ?? 0;
  const momentNav = moments.length ? (
    <KeyMomentNav moments={moments} selectedPly={selectedPly} onSelectNode={goToNode} />
  ) : null;
  const finished = hasReview && !reviewRunning ? review : null;
  const shown = hasReview || (analysisMode && mainline.length > 0);

  return (
    <>
      {shown ? (
        <div className="border-b border-line-subtle px-3 pb-1">
          {/* Its top edge is the charts' splitter, against the panel content above. */}
          <ReviewCharts
            moves={moves}
            variationSelected={!onMainline}
            selectedNodeId={currentNodeId}
            onSelectNode={goToNode}
            reviewedSide={side}
            totalPlies={reviewRunning ? mainline.length : undefined}
            keyMomentIds={momentIds}
            actions={momentNav}
            opening={finished ? finished.opening : undefined}
            mainline={mainline}
            timeControl={timeControl}
            maia={{
              model: finished?.rating?.maiaModel ?? null,
              rating: finished?.rating?.rating ?? 1500,
              // Reviews before schema 2 stored made-up Maia probabilities; a running one is new.
              trusted: reviewRunning || (finished?.schemaVersion ?? 0) >= 2
            }}
            // No Maia data here hides the strip: reviews (and Maia) live in Game review.
            maiaPrompt={false}
          />
        </div>
      ) : null}
      <MoveNavigation />
    </>
  );
}

const EMPTY_REVIEW_MOVES: MoveReview[] = [];

/**
 * "Add to repertoire…" for the board's game: the line to the selected move (the whole game from
 * the starting position). Reads the game store; never writes to it.
 */
function AddToRepertoireButton() {
  const available = useGameStore((state) => hasMoves(state.moveTree));
  if (!window.chaturanga?.repertoires) return null;
  const open = async () => {
    const source = await captureBoardSource();
    if (!source) {
      useAppNoticeStore.getState().show(ADD_NEEDS_SAVE);
      return;
    }
    useAddToRepertoireStore.getState().open({
      source,
      initialScope: source.nodeId
        ? { kind: "path", toNodeId: source.nodeId }
        : { kind: "whole-game" },
      entry: "board"
    });
  };
  return (
    <div className="flex shrink-0 justify-end">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={!available}
        onClick={() => void open()}
      >
        <BookPlus />
        Add to repertoire…
      </Button>
    </div>
  );
}

const addToRepertoireButton = <AddToRepertoireButton />;
const boardView = <BoardView />;
const gameSummary = <GameSummary />;
/**
 * On the Engine tab the summary row also holds the Analysis switch (live analysis on and off: the
 * only Start / Stop for the panel's engine) and the analysis settings, last.
 */
const EngineTabSummary = memo(function EngineTabSummary({
  onStartAnalysis,
  onStopAnalysis
}: {
  onStartAnalysis?: () => void;
  onStopAnalysis?: () => void;
}) {
  return (
    <div className="flex w-full items-center justify-between gap-2">
      <GameSummary />
      <div className="flex shrink-0 items-center gap-2.5">
        <AnalysisSwitch onStart={onStartAnalysis} onStop={onStopAnalysis} />
        <AnalysisSettingsButton />
      </div>
    </div>
  );
});

/**
 * The Analysis switch: on while live analysis runs (the game store's analysis mode, which the
 * engine driver searches), so it always says what the engine is doing. Off without an engine
 * installed (it says why), or while the board can't be analysed (a game being played).
 */
function AnalysisSwitch({ onStart, onStop }: { onStart?: () => void; onStop?: () => void }) {
  const on = useGameStore((state) => state.mode === "analysis");
  const engines = useEnginesQuery();
  const noEngine = engines.isSuccess && !engines.data.some((engine) => engine.isAvailable);
  const disabled = noEngine || (on ? !onStop : !onStart);
  const control = (
    <label className="flex items-center gap-1.5 text-xs text-fg-secondary">
      <Switch
        checked={on}
        disabled={disabled}
        aria-label="Analysis"
        onCheckedChange={(next) => (next ? onStart?.() : onStop?.())}
      />
      <span aria-hidden>Analysis</span>
    </label>
  );
  if (!noEngine) return control;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a disabled switch can't take focus, so its wrapper does, to say why it's off
          tabIndex={0}
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          {control}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">Install an engine in Settings to analyse</TooltipContent>
    </Tooltip>
  );
}

/** Opens the live analysis settings (engine, lines, search limit, board display). */
function AnalysisSettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton
        label="Analysis settings"
        icon={<Settings />}
        onClick={() => setOpen(true)}
        className="shrink-0"
      />
      {open ? <AnalysisSettingsDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}
const gameFooter = <GameFooter />;

/** The store's termination strings in the words the board's result card uses. */
const TERMINATION_LABELS: Record<string, string> = {
  "Player resign": "Resignation",
  "Time forfeit": "On time",
  "Draw by agreement": "Agreement"
};

function terminationLabel(termination: string): string {
  return TERMINATION_LABELS[termination] ?? capitalize(termination);
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}
