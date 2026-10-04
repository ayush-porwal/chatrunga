import type { GameOpening, MoveReview, ReviewCommentary } from "@chaturanga/shared/types/engine";
import type { Color, MoveNode } from "@chaturanga/shared/types/chess";
import type { KeyMoment } from "@chaturanga/shared/chess/key-moments";
import { useState } from "react";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";
import { TreeView } from "../game/TreeView";
import { activeBestLine } from "../game/best-line-cursor";
import { useGameStore } from "../../stores/game-store";
import { loadMovesView, saveMovesView, type MovesView } from "../game/move-list-prefs";
import { MomentList } from "./KeyMoments";

const viewOptions: readonly SegmentedOption<MovesView>[] = [
  { value: "moves", label: "Moves" },
  { value: "key", label: "Key insights" }
];

const NO_MOVES: readonly MoveReview[] = [];
const NO_MOMENTS: readonly KeyMoment[] = [];

/**
 * The Moves tab: the move list (main line + variations) with each move's mark and score, or the
 * key insights (the game's key moments). The view picked is remembered.
 */
export function ReviewMoveRail({
  nodes,
  selectedNodeId,
  reviews,
  commentaryByNodeId,
  onSelectNode,
  moves = NO_MOVES,
  keyMoments = NO_MOMENTS,
  opening,
  orientation
}: {
  nodes: readonly MoveNode[];
  selectedNodeId: string | null;
  reviews: ReadonlyMap<string, MoveReview>;
  commentaryByNodeId: ReadonlyMap<string, ReviewCommentary>;
  onSelectNode: (nodeId: string) => void;
  /** The reviewed moves the lists point at. */
  moves?: readonly MoveReview[];
  keyMoments?: readonly KeyMoment[];
  /** The game's opening, named after the last book move. */
  opening?: GameOpening | null;
  /** The board's orientation, for the BEST lines' preview boards. */
  orientation?: Color;
}) {
  const [view, setView] = useState<MovesView>(loadMovesView);
  const changeView = (next: MovesView) => {
    saveMovesView(next);
    setView(next);
  };
  // A BEST line's move is shown on the board without being added to the game.
  const showBestLine = useGameStore((state) => state.showBestLine);
  const bestLine = useGameStore(activeBestLine);
  const tree = (
    <TreeView
      nodes={nodes}
      selectedNodeId={selectedNodeId}
      onSelectNode={onSelectNode}
      reviews={reviews}
      commentaryByNodeId={commentaryByNodeId}
      showCommentaryState
      opening={opening}
      onBrowseLine={showBestLine}
      activeBestLine={bestLine}
      orientation={orientation}
      emptyLabel="No moves to review."
      ariaLabel="Reviewed move tree"
      className="-mr-3 h-full pr-3"
    />
  );
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2">
      <SegmentedControl
        ariaLabel="Moves shown"
        size="sm"
        fullWidth
        options={viewOptions}
        value={view}
        onChange={changeView}
      />
      {view === "moves" ? (
        tree
      ) : (
        <div className="scroll-area -mr-3 min-h-0 overflow-y-auto pr-3">
          <MomentList
            moments={keyMoments}
            moves={moves}
            selectedNodeId={selectedNodeId}
            onSelectNode={onSelectNode}
            label="Key insights"
            emptyTitle="No key insights yet."
          />
        </div>
      )}
    </div>
  );
}
