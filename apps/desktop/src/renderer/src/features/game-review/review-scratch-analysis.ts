import { useEffect, useMemo } from "react";
import { standardCastlingUci } from "@chaturanga/shared/chess/review";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { useAnalysisStore } from "../../stores/analysis-store";
import { useGameStore } from "../../stores/game-store";
import { currentLineUcis } from "../analysis/engine-game-helpers";
import type { AnalysisTarget } from "../analysis/live-analysis";
import { activeScratchLine, type ScratchLine } from "../game/scratch-line";

/**
 * What live analysis searches on Game review's scratch line: its position, reached by the game's
 * moves to the line's anchor and then the line's moves up to the one shown (castling as the king's
 * two-square move, as the engine is sent the game's). Null when the anchor is gone.
 */
export function scratchAnalysisTarget(
  moveTree: MoveNode[],
  rootFen: string,
  line: ScratchLine
): AnalysisTarget | null {
  const anchor = moveTree.find((node) => node.id === line.anchorNodeId);
  if (!anchor) return null;
  const moves = currentLineUcis(moveTree, anchor.id);
  let fen = anchor.fenAfter;
  for (const step of line.moves.slice(0, line.index + 1)) {
    moves.push(standardCastlingUci(fen, step.uci));
    fen = step.fenAfter;
  }
  return { owner: "review-scratch", nodeId: line.originNodeId, rootFen, moves, fen };
}

/**
 * Live analysis in Game review runs on the user's own moves only: while the board shows a scratch
 * line and `on` (the Engine tab's switch, and no review running: that search has the engine's
 * time), its position is live analysis's target. Leaving the line or the page clears the target,
 * which stops the search.
 */
export function useReviewScratchAnalysis(on: boolean): void {
  const scratch = useGameStore(activeScratchLine);
  const moveTree = useGameStore((state) => state.moveTree);
  const rootFen = useGameStore((state) => state.rootFen);
  const target = useMemo(
    () => (scratch && on ? scratchAnalysisTarget(moveTree, rootFen, scratch) : null),
    [moveTree, on, rootFen, scratch]
  );
  useEffect(() => {
    if (!target) return;
    useAnalysisStore.getState().setTarget(target);
    return () => useAnalysisStore.getState().setTarget(null);
  }, [target]);
}
