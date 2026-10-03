import { lazy, memo, Suspense, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { BookPlus, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { AnalysisSettingsDialog } from "../features/analysis/AnalysisSettingsDialog";
import { useShallow } from "zustand/react/shallow";
import { QualityBadge } from "@/components/ui/quality-badge";
import { SegmentedControl, tabPanelProps, type SegmentedOption } from "@/components/ui/segmented-control";
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

// The eval chart (recharts) loads only once a reviewed game needs it.
const ReviewTape = lazy(() => import("../features/game-review/ReviewTape").then((module) => ({ default: module.ReviewTape })));

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
  { value: "engine", label: "Engine", disabled: true, disabledReason: "Available after the puzzle is solved or failed" }
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
          options={puzzleTabs === "none" ? sideTabOptions : puzzleTabs === "locked" ? lockedPuzzleTabOptions : puzzleTabOptions}
        />
      }
      summary={shownTab === "engine" ? engineTabSummary : gameSummary}
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
          <EngineStatusPanel onStartAnalysis={onStartAnalysis} onStopAnalysis={onStopAnalysis} onOpenSettings={onOpenSettings} />
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
    gameOutcome?.termination ?? (position.isCheckmate ? "checkmate" : position.isStalemate ? "stalemate" : null);

  return (
    <StatGroup className="w-full">
      {ended ? (
        <Stat label="Result" value={termination ? `${result} · ${terminationLabel(termination)}` : result} />
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
          <Stat label="Move" value={<QualityBadge classification={currentMoveReview.classification} />} />
          <Stat label="Eval" value={formatMoveEval(currentMoveReview)} mono />
        </>
      ) : null}
    </StatGroup>
  );
}

/** Eval graph when the loaded game has been reviewed, then move navigation. */
function GameFooter() {
  const currentNodeId = useGameStore((state) => state.currentNodeId);
  const moveTree = useGameStore((state) => state.moveTree);
  const orientation = useGameStore((state) => state.orientation);
  const goToNode = useGameStore((state) => state.goToNode);
  const reviewStatus = useReviewStore((state) => state.status);
  const reviewMoves = useDisplayedReviewMoves();
  const onReviewedLine = useMemo(
    () => currentNodeId === "root" || reviewMoves.some((move) => move.nodeId === currentNodeId),
    [currentNodeId, reviewMoves]
  );
  // Only offer the graph when the review belongs to the loaded game.
  const hasReview = useMemo(() => {
    if (!reviewMoves.length) return false;
    const nodeIds = new Set(moveTree.map((node) => node.id));
    return reviewMoves.every((move) => nodeIds.has(move.nodeId));
  }, [moveTree, reviewMoves]);
  const reviewRunning = reviewStatus === "running";
  // While a review pass runs, pin the graph's x-axis to the whole game so it grows in place.
  const mainlinePlies = useMemo(() => (reviewRunning ? mainlineReviewInput(moveTree).length : 0), [moveTree, reviewRunning]);

  return (
    <>
      {hasReview ? (
        <div className="border-b border-line-subtle px-3 pb-1 pt-2">
          {/* Reserves the chart's height while its code loads (the first review only). */}
          <Suspense fallback={<div className="h-36" aria-hidden="true" />}>
            <ReviewTape
              moves={reviewMoves}
              variationSelected={!onReviewedLine}
              selectedNodeId={currentNodeId}
              onSelectNode={goToNode}
              orientation={orientation}
              totalPlies={reviewRunning ? mainlinePlies : undefined}
            />
          </Suspense>
        </div>
      ) : null}
      <MoveNavigation />
    </>
  );
}

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
      initialScope: source.nodeId ? { kind: "path", toNodeId: source.nodeId } : { kind: "whole-game" },
      entry: "board"
    });
  };
  return (
    <div className="flex shrink-0 justify-end">
      <Button type="button" variant="ghost" size="xs" disabled={!available} onClick={() => void open()}>
        <BookPlus />
        Add to repertoire…
      </Button>
    </div>
  );
}

const addToRepertoireButton = <AddToRepertoireButton />;
const boardView = <BoardView />;
const gameSummary = <GameSummary />;
/** On the Engine tab the summary row also holds the analysis settings. */
const engineTabSummary = (
  <div className="flex w-full items-center justify-between gap-2">
    <GameSummary />
    <AnalysisSettingsButton />
  </div>
);

/** Opens the live analysis settings (engine, lines, search limit, board display). */
function AnalysisSettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton label="Analysis settings" icon={<SlidersHorizontal />} onClick={() => setOpen(true)} className="shrink-0" />
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
