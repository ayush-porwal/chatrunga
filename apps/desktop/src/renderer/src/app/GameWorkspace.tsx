import { memo, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { BookPlus, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { tabPanelProps } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import { AnalysisSettingsDialog } from "../features/analysis/AnalysisSettingsDialog";
import { BoardView } from "../features/board/BoardView";
import { mainBoardSurface } from "../features/board/move-mark";
import { BoardWorkspace } from "../features/board/BoardWorkspace";
import {
  useMainlineMoveCount,
  WorkspaceTabBar,
  type WorkspaceTab
} from "../features/board/WorkspaceTabBar";
import { MoveNavigation } from "../features/board/MoveNavigation";
import { EngineStatusPanel } from "../features/analysis/EngineStatusPanel";
import { BroadcastLivePanel } from "../features/broadcasts/BroadcastLivePanel";
import { MoveList } from "../features/game/MoveList";
import {
  LibraryActions,
  RecentGames,
  useLibraryView,
  type LibraryView
} from "../features/game/RecentGames";
import { mainlineReviewInput } from "../features/game-review/review-utils";
import { ReviewCharts } from "../features/game-review/ReviewCharts";
import { reviewSideColor, useReviewSide } from "../features/game-review/review-side";
import { moverOf } from "../features/game-review/review-summary";
import { keyMoments } from "@chaturanga/shared/chess/key-moments";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import { hasMoves } from "../features/repertoire/add-from-game";
import { ADD_NEEDS_SAVE, captureBoardSource } from "../features/repertoire/board-source";
import { useAddToRepertoireStore } from "../stores/add-to-repertoire-store";
import { useAppNoticeStore } from "../stores/app-notice-store";
import { useGameStore } from "../stores/game-store";
import { useReviewStore } from "../stores/review-store";
import { useDisplayedReviewMoves } from "../stores/review-validity";
import { DESTINATION_ICONS } from "./destination-icons";
import { availableSideTab, showsEngine, type SideTab } from "./side-tabs";
import { usePuzzleTabs } from "./use-puzzle-tabs";

/**
 * The game view (free board, Analysis, engine and Lichess games, Puzzle) rendered through the shared board
 * workspace — same geometry as Game review. Title-bar tabs: Moves · Library (a puzzle has only
 * Moves, its card atop the moves). Moves: the engine block fixed on top (not while a puzzle is
 * being solved: it would give the answer away), then the move tree, scrolling on its own.
 * Footer: the charts, then move navigation.
 */
export const GameWorkspace = memo(function GameWorkspace({
  onOpenGame,
  sideTab,
  onSideTabChange,
  puzzlePanel,
  onStartAnalysis,
  onStopAnalysis,
  onOpenSettings,
  onExportPgn
}: {
  /** Library tab: open a saved game on the board. */
  onOpenGame: (id: string) => void;
  sideTab: SideTab;
  onSideTabChange: (tab: SideTab) => void;
  puzzlePanel: ReactNode;
  onStartAnalysis?: () => void;
  onStopAnalysis?: () => void;
  onOpenSettings?: () => void;
  /** The Moves tab's Export PGN: the game with its analysis. */
  onExportPgn: () => void;
}) {
  // The per-move parts (board, footer) subscribe on their own, so stepping through the game
  // re-renders them and not the whole workspace (tabs, panel, puzzle card).
  const panelId = useId();
  const puzzleTabs = usePuzzleTabs();
  const shownTab = availableSideTab(sideTab, puzzleTabs);
  // Kept here so the Library's filter and search outlive a visit to Moves.
  const libraryView = useLibraryView();
  // A tab the puzzle doesn't offer (Library) is never kept as the stored one.
  useEffect(() => {
    if (shownTab !== sideTab) onSideTabChange(shownTab);
  }, [onSideTabChange, shownTab, sideTab]);
  const engineShown = showsEngine(puzzleTabs);
  return (
    <BoardWorkspace
      tabPanel={tabPanelProps(panelId, shownTab)}
      panelLabel="Game"
      board={boardView}
      tabBar={
        <PanelTabBar
          panelId={panelId}
          tab={shownTab}
          withLibrary={puzzleTabs === "none"}
          libraryView={libraryView}
          onChange={onSideTabChange}
          onExportPgn={onExportPgn}
        />
      }
      flushBody
      footer={gameFooter}
    >
      {shownTab === "notation" ? (
        <div className="flex h-full min-h-0 flex-col">
          {/* A followed broadcast game: following live, or the way back to it. */}
          <BroadcastLivePanel />
          {engineShown ? (
            <EngineStatusPanel
              onOpenSettings={onOpenSettings}
              onStartAnalysis={onStartAnalysis}
              onStopAnalysis={onStopAnalysis}
            />
          ) : null}
          {/* A puzzle card taller than the panel (a short window, an explanation) scrolls with the
              moves rather than running under the footer. The tree's header sits right under the
              engine block. */}
          <div
            className={cn(
              "scroll-area flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3",
              (!engineShown || puzzlePanel) && "pt-3"
            )}
          >
            {puzzlePanel}
            <section className="flex min-h-40 flex-1 flex-col" aria-label="Moves">
              <MoveList />
            </section>
            {/* A puzzle isn't saved, so it can't be added to a repertoire. */}
            {puzzleTabs === "none" ? addToRepertoireButton : null}
          </div>
        </div>
      ) : (
        <RecentGames view={libraryView} onOpenGame={onOpenGame} />
      )}
    </BoardWorkspace>
  );
});

/**
 * The panel's title bar: Moves (the game's length) · Library (its games), and at the right end the
 * tab's own actions: on Moves, Export PGN and the analysis settings (last); on Library, its search
 * and filter.
 */
const PanelTabBar = memo(function PanelTabBar({
  panelId,
  tab,
  withLibrary,
  libraryView,
  onChange,
  onExportPgn
}: {
  panelId: string;
  tab: SideTab;
  /** A puzzle has no Library. */
  withLibrary: boolean;
  libraryView: LibraryView;
  onChange: (tab: SideTab) => void;
  onExportPgn: () => void;
}) {
  const moveCount = useMainlineMoveCount();
  const tabs: WorkspaceTab<SideTab>[] = [
    { value: "notation", label: "Moves", count: moveCount },
    ...(withLibrary
      ? [{ value: "library" as const, label: "Library", count: libraryView.total }]
      : [])
  ];
  return (
    <WorkspaceTabBar
      panelId={panelId}
      ariaLabel="Workspace panels"
      tabs={tabs}
      value={tab}
      onChange={onChange}
      actions={
        tab === "notation" ? (
          <>
            <ExportPgnButton onClick={onExportPgn} />
            <AnalysisSettingsButton />
          </>
        ) : (
          <LibraryActions view={libraryView} />
        )
      }
    />
  );
});

/** Export PGN: the game on the board, with its analysis, as a .pgn file. */
function ExportPgnButton({ onClick }: { onClick: () => void }) {
  const Icon = DESTINATION_ICONS.exportPgn;
  return (
    <IconButton
      label="Export PGN with analysis"
      icon={<Icon />}
      size="icon-xs"
      disabled={!window.chaturanga}
      onClick={onClick}
    />
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
  // The Analyze board: live analysis, or the sidebar's Analyze before its engine is switched on.
  const analyzeBoard = useGameStore(
    (state) => mainBoardSurface(state.mode, state.analysisBoard) === "analysis"
  );
  const goToNode = useGameStore((state) => state.goToNode);
  const { hasReview, maia, moves, opening, running } = useLoadedGameReview(moveTree);
  const mainline = useMemo(() => mainlineReviewInput(moveTree), [moveTree]);
  const onMainline = useMemo(
    () => currentNodeId === "root" || mainline.some((move) => move.nodeId === currentNodeId),
    [currentNodeId, mainline]
  );
  const side = reviewSideColor(useReviewSide(orientation));
  // The reviewed side's key insights, once a finished review has them.
  const moments = useMemo(
    () => (hasReview && !running ? keyMoments(moves.filter((move) => moverOf(move) === side)) : []),
    [hasReview, moves, running, side]
  );
  const momentIds = useMemo(() => new Set(moments.map((moment) => moment.nodeId)), [moments]);
  const shown = hasReview || (analyzeBoard && mainline.length > 0);

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
            totalPlies={running ? mainline.length : undefined}
            keyMomentIds={momentIds}
            opening={opening}
            mainline={mainline}
            timeControl={timeControl}
            maia={maia}
            // No Maia data here hides the strip: reviews (and Maia) live in Game review.
            maiaPrompt={false}
          />
        </div>
      ) : null}
      <MoveNavigation />
    </>
  );
}

/**
 * The review store's review, for the footer charts, when it belongs to the loaded game (none
 * otherwise): its moves, whether it is still running, and once finished its opening and Maia data.
 */
function useLoadedGameReview(moveTree: readonly MoveNode[]) {
  const reviewStatus = useReviewStore((state) => state.status);
  const review = useReviewStore((state) => state.review);
  const reviewMoves = useDisplayedReviewMoves();
  // Only use the review when it belongs to the loaded game.
  const hasReview = useMemo(() => {
    if (!reviewMoves.length) return false;
    const nodeIds = new Set(moveTree.map((node) => node.id));
    return reviewMoves.every((move) => nodeIds.has(move.nodeId));
  }, [moveTree, reviewMoves]);
  const running = reviewStatus === "running";
  const finished = hasReview && !running ? review : null;
  return {
    hasReview,
    moves: hasReview ? reviewMoves : EMPTY_REVIEW_MOVES,
    running,
    opening: finished?.opening,
    maia: {
      model: finished?.rating?.maiaModel ?? null,
      rating: finished?.rating?.rating ?? 1500,
      // Reviews before schema 2 stored made-up Maia probabilities; a running one is new.
      trusted: running || (finished?.schemaVersion ?? 0) >= 2
    }
  };
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
/** Opens the live analysis settings (engine, lines, search limit, board display). */
function AnalysisSettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton
        label="Analysis settings"
        icon={<Settings />}
        size="icon-xs"
        onClick={() => setOpen(true)}
        className="shrink-0"
      />
      {open ? <AnalysisSettingsDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}
const gameFooter = <GameFooter />;
