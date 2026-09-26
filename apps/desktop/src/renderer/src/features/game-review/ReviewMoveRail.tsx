import type { MoveReview, ReviewCommentary } from "@chaturanga/shared/types/engine";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { TreeView } from "../game/TreeView";

/** Full move tree (main line + variations) annotated with review classifications and scores. */
export function ReviewMoveRail({
  nodes,
  selectedNodeId,
  reviews,
  commentaryByNodeId,
  onSelectNode
}: {
  nodes: readonly MoveNode[];
  selectedNodeId: string | null;
  reviews: ReadonlyMap<string, MoveReview>;
  commentaryByNodeId: ReadonlyMap<string, ReviewCommentary>;
  onSelectNode: (nodeId: string) => void;
}) {
  return (
    <TreeView
      nodes={nodes}
      selectedNodeId={selectedNodeId}
      onSelectNode={onSelectNode}
      reviews={reviews}
      commentaryByNodeId={commentaryByNodeId}
      showScores
      showCommentaryState
      emptyLabel="No moves to review."
      ariaLabel="Reviewed move tree"
      className="-mr-3 h-full pr-3"
    />
  );
}
