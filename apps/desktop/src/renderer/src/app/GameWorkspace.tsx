import { useMemo, type ReactNode } from "react";
import { statusForFen } from "@chaturanga/shared/chess/position";
import { QualityBadge } from "@/components/ui/quality-badge";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";
import { SideDot } from "@/components/ui/side-dot";
import { Stat, StatGroup } from "@/components/ui/stat";
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
 * The game view (New game, Analysis, Engine game, Puzzle) rendered through the shared board
 * workspace — same geometry as Game review. Tabs: Moves · Engine · Library (the puzzle card sits
 * atop Moves). Footer: eval graph when the game has been reviewed, then move navigation.
 */
export function GameWorkspace({
  sideTab,
  onSideTabChange,
  showPanel,
  puzzlePanel,
  onStartAnalysis
}: {
  sideTab: SideTab;
  onSideTabChange: (tab: SideTab) => void;
  showPanel: boolean;
  puzzlePanel: ReactNode;
  onStartAnalysis?: () => void;
}) {
  const currentFen = useGameStore((state) => state.currentFen);
  const currentNodeId = useGameStore((state) => state.currentNodeId);
  const moveTree = useGameStore((state) => state.moveTree);
  const orientation = useGameStore((state) => state.orientation);
  const gameOutcome = useGameStore((state) => state.gameOutcome);
  const goToNode = useGameStore((state) => state.goToNode);
  const reviewStatus = useReviewStore((state) => state.status);
  const reviewMoves = useReviewStore(selectDisplayedMoves);
  const status = useMemo(() => statusForFen(currentFen), [currentFen]);
  const currentMoveReview = useMemo(
    () => reviewMoves.find((move) => move.nodeId === currentNodeId) ?? null,
    [currentNodeId, reviewMoves]
  );
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

  const ended = Boolean(gameOutcome) || status.isEnd;
  const result = gameOutcome?.result ?? status.result;
  const termination =
    gameOutcome?.termination ?? (status.isCheckmate ? "checkmate" : status.isStalemate ? "stalemate" : null);

  return (
    <BoardWorkspace
      showPanel={showPanel}
      panelLabel="Game"
      board={<BoardView />}
      tabs={
        <SegmentedControl
          ariaLabel="Workspace panels"
          role="tablist"
          fullWidth
          className={workspaceTabsClass}
          value={sideTab}
          onChange={onSideTabChange}
          options={sideTabOptions}
        />
      }
      summary={
        <StatGroup className="w-full">
          {ended ? (
            <Stat label="Result" value={termination ? `${result} · ${capitalize(termination)}` : result} />
          ) : (
            <Stat
              label="To move"
              value={
                <span className="inline-flex items-center gap-2">
                  <SideDot color={status.turn} />
                  {status.turn === "white" ? "White" : "Black"}
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
      }
      footer={
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
      }
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
          <EngineStatusPanel onStartAnalysis={onStartAnalysis} />
        </div>
      ) : null}
      {sideTab === "library" ? <RecentGames /> : null}
    </BoardWorkspace>
  );
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}
