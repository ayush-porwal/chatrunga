import { useCallback, useMemo } from "react";
import type { GameOpening, MoveReview, ReviewCommentary } from "@chaturanga/shared/types/engine";
import type { Color, MoveNode } from "@chaturanga/shared/types/chess";
import { TreeView } from "../game/TreeView";
import { activeBestLine } from "../game/best-line-cursor";
import { activeScratchLine } from "../game/scratch-line";
import { scratchLineRow } from "../game/ScratchLineRow";
import { useGameStore } from "../../stores/game-store";

/**
 * The Moves tab: the move tree (main line + variations) with each move's mark and score, the
 * BEST line under each error (the key moments are in the Summary) and the scratch line of moves
 * tried on the board.
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
  // The moves tried on the board: shown as a row of their own, never added to the game.
  const showScratchLine = useGameStore((state) => state.showScratchLine);
  const scratchLine = useGameStore(activeScratchLine);
  const scratchOrigin = scratchLine?.originNodeId ?? null;
  const leaveScratch = useCallback(() => {
    if (scratchOrigin) onSelectNode(scratchOrigin);
  }, [onSelectNode, scratchOrigin]);
  const scratchRow = useMemo(
    () => scratchLineRow(nodes, scratchLine, showScratchLine, leaveScratch),
    [leaveScratch, nodes, scratchLine, showScratchLine]
  );
  return (
    <TreeView
      nodes={nodes}
      // On the scratch line its move is the current one: no game move is.
      selectedNodeId={scratchLine ? null : selectedNodeId}
      onSelectNode={onSelectNode}
      reviews={reviews}
      commentaryByNodeId={commentaryByNodeId}
      showCommentaryState
      opening={opening}
      onBrowseLine={showBestLine}
      activeBestLine={bestLine}
      scratchRow={scratchRow}
      orientation={orientation}
      emptyLabel="No moves to review."
      ariaLabel="Reviewed move tree"
      className="-mr-3 h-full pr-3"
    />
  );
}
