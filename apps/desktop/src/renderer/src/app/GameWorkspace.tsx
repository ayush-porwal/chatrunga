import { memo, useId, useMemo, type ReactNode } from "react";
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
import { ReviewTape } from "../features/game-review/ReviewTape";
import { mainlineReviewInput } from "../features/game-review/review-utils";
import { formatMoveEval } from "../features/game-review/review-score";
import { useGameStore } from "../stores/game-store";
import { selectDisplayedMoves, useReviewStore } from "../stores/review-store";

export type SideTab = "notation" | "engine" | "library";

const sideTabOptions: readonly SegmentedOption<SideTab>[] = [
  { value: "notation", label: "Moves" },
  { value: "engine", label: "Engine" },
  { value: "library", label: "Library" }
];

/**
 * The game view (free board, Analysis, engine and Lichess games, Puzzle) rendered through the shared board
 * workspace — same geometry as Game review. Tabs: Moves · Engine · Library (the puzzle card sits
 * atop Moves). Footer: eval graph when the game has been reviewed, then move navigation.
 */
export const GameWorkspace = memo(function GameWorkspace({
  onOpenGame,
  sideTab,
  onSideTabChange,
  puzzlePanel,
  onStartAnalysis,
  onOpenSettings
}: {
  /** Library tab: open a saved game on the board. */
  onOpenGame: (id: string) => void;
  sideTab: SideTab;
  onSideTabChange: (tab: SideTab) => void;
  puzzlePanel: ReactNode;
  onStartAnalysis?: () => void;
  onOpenSettings?: () => void;
}) {
  // The per-move parts (board, summary, footer) subscribe on their own, so stepping through the
  // game re-renders them and not the whole workspace (tabs, panel, puzzle card).
  const panelId = useId();
  return (
    <BoardWorkspace
      tabPanel={tabPanelProps(panelId, sideTab)}
      panelLabel="Game"
      board={boardView}
      tabs={
        <SegmentedControl
          ariaLabel="Workspace panels"
          role="tablist"
          panelId={panelId}
          fullWidth
          className={workspaceTabsClass}
          value={sideTab}
          onChange={onSideTabChange}
          options={sideTabOptions}
        />
      }
      summary={gameSummary}
      footer={gameFooter}
    >
      {sideTab === "notation" ? (
        <div className="flex h-full min-h-0 flex-col gap-3">
          {puzzlePanel}
          <section className="flex min-h-40 flex-1 flex-col" aria-label="Moves">
            <MoveList />
          </section>
        </div>
      ) : null}
      {sideTab === "engine" ? (
        <div className="scroll-area -mr-3 h-full min-h-0 overflow-y-auto pr-3">
          <EngineStatusPanel onStartAnalysis={onStartAnalysis} onOpenSettings={onOpenSettings} />
        </div>
      ) : null}
      {sideTab === "library" ? <RecentGames onOpenGame={onOpenGame} /> : null}
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
  const reviewMoves = useReviewStore(selectDisplayedMoves);
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
  const reviewMoves = useReviewStore(selectDisplayedMoves);
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
          <ReviewTape
            moves={reviewMoves}
            variationSelected={!onReviewedLine}
            selectedNodeId={currentNodeId}
            onSelectNode={goToNode}
            orientation={orientation}
            totalPlies={reviewRunning ? mainlinePlies : undefined}
          />
        </div>
      ) : null}
      <MoveNavigation />
    </>
  );
}

const boardView = <BoardView />;
const gameSummary = <GameSummary />;
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
