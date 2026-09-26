import { useCallback, useMemo } from "react";
import { useGameStore } from "../../stores/game-store";
import { reviewsByNode, selectDisplayedMoves, useReviewStore } from "../../stores/review-store";
import { TreeView } from "./TreeView";

export function MoveList() {
  const moveTree = useGameStore((state) => state.moveTree);
  const currentNodeId = useGameStore((state) => state.currentNodeId);
  const goToNode = useGameStore((state) => state.goToNode);
  const deleteLineFromNode = useGameStore((state) => state.deleteLineFromNode);
  const reviewMoves = useReviewStore(selectDisplayedMoves);
  const reviews = useMemo(() => reviewsByNode(reviewMoves), [reviewMoves]);
  // Stable so the memoised move rows skip re-rendering while stepping through the game.
  const onDeleteLine = useCallback(
    (nodeId: string) => {
      if (window.confirm("Delete this move and all following moves in this line?")) deleteLineFromNode(nodeId);
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
      emptyLabel="No moves yet."
      ariaLabel="Game moves"
      className="scroll-area min-h-0 flex-1 overflow-x-hidden tabular-nums"
    />
  );
}
