import type { DrawShape } from "@lichess-org/chessground/draw";
import { uciSquares } from "@chaturanga/shared/chess/square";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { mainlineNodeAtPly, type InsightsReviewFocus } from "./insights-return";

/** The node of the position where the issue's move was played (its parent), or null. */
export function decisionNodeId(moveTree: readonly MoveNode[], ply: number): string | null {
  return mainlineNodeAtPly(moveTree, ply)?.parentId ?? null;
}

/**
 * The board's arrows at the position where the game left the repertoire (`nodeId` is the shown
 * position): the repertoire's moves in green and the move played instead in red for a forgotten
 * move; the reply the repertoire doesn't cover in yellow. None at any other position.
 */
export function insightsDecisionShapes(
  focus: InsightsReviewFocus | null,
  moveTree: readonly MoveNode[],
  nodeId: string
): DrawShape[] {
  const issue = focus?.issue;
  if (!issue || decisionNodeId(moveTree, issue.ply) !== nodeId) return [];
  if (focus.outcome === "forgot") {
    return [
      ...issue.expectedUcis.flatMap((uci) => arrow(uci, "green")),
      ...arrow(issue.playedUci, "red")
    ];
  }
  return focus.outcome === "new-reply" ? arrow(issue.playedUci, "yellow") : [];
}

function arrow(uci: string | null, brush: string): DrawShape[] {
  const squares = uci ? uciSquares(uci) : null;
  return squares ? [{ orig: squares[0], dest: squares[1], brush }] : [];
}
