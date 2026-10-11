import type { GameOpening, MoveReview, ReviewCommentary } from "@chaturanga/shared/types/engine";
import type { Color, MoveNode } from "@chaturanga/shared/types/chess";
import { TreeView } from "../game/TreeView";
import { activeBestLine } from "../game/best-line-cursor";
import { useGameStore } from "../../stores/game-store";

/**
 * The Moves tab: the move tree (main line + variations) with each move's mark and score, and the
 * BEST line under each error (the key moments are in the Summary).
 */
export function ReviewMoveRail({
  nodes,
  selectedNodeId,
  reviews,
  commentaryByNodeId,
  onSelectNode,
  opening,
  orientation
}: {
  nodes: readonly MoveNode[];
  selectedNodeId: string | null;
  reviews: ReadonlyMap<string, MoveReview>;
  commentaryByNodeId: ReadonlyMap<string, ReviewCommentary>;
  onSelectNode: (nodeId: string) => void;
  /** The game's opening, named after the last book move. */
  opening?: GameOpening | null;
  /** The board's orientation, for the BEST lines' preview boards. */
  orientation?: Color;
}) {
  // A BEST line's move is shown on the board without being added to the game.
  const showBestLine = useGameStore((state) => state.showBestLine);
  const bestLine = useGameStore(activeBestLine);
  return (
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
}
