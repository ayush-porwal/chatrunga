import { useCallback, useMemo } from "react";
import { useGameStore } from "../../stores/game-store";
import { reviewsByNode, useReviewStore } from "../../stores/review-store";
import { useDisplayedReviewMoves } from "../../stores/review-validity";
import type { PlayLine } from "./BestLineRow";
import { TreeView } from "./TreeView";

/** A BEST line's move: the line is played from the error's parent as a variation. */
const playLine: PlayLine = (target) => {
  useGameStore.getState().goToLine(target.startNodeId, target.moves);
};

export function MoveList() {
  const moveTree = useGameStore((state) => state.moveTree);
  const currentNodeId = useGameStore((state) => state.currentNodeId);
  const goToNode = useGameStore((state) => state.goToNode);
  const deleteLineFromNode = useGameStore((state) => state.deleteLineFromNode);
  const orientation = useGameStore((state) => state.orientation);
  const reviewMoves = useDisplayedReviewMoves();
  const reviews = useMemo(() => reviewsByNode(reviewMoves), [reviewMoves]);
  // A finished review's opening (a running pass hasn't placed the book yet).
  const opening = useReviewStore((state) =>
    state.status === "running" ? null : (state.review?.opening ?? null)
  );
  // Stable so the memoised move rows skip re-rendering while stepping through the game.
  const onDeleteLine = useCallback(
    (nodeId: string) => {
      if (window.confirm("Delete this move and all following moves in this line?"))
        deleteLineFromNode(nodeId);
    },
    [deleteLineFromNode]
  );

  return (
    <TreeView
      nodes={moveTree}
      selectedNodeId={currentNodeId}
      onSelectNode={goToNode}
      reviews={reviews}
      onDeleteLine={onDeleteLine}
      opening={opening}
      onPlayLine={playLine}
      orientation={orientation}
      emptyLabel="No moves yet."
      ariaLabel="Game moves"
      className="scroll-area min-h-0 flex-1 overflow-x-hidden tabular-nums"
    />
  );
}
