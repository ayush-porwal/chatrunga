import { useMemo } from "react";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import { useGameStore } from "./game-store";
import { selectDisplayedMoves, useReviewStore, type ReviewLineMove } from "./review-store";

/** The main line's moves by node id. */
function mainlineById(moveTree: readonly MoveNode[]): Map<string, MoveNode> {
  const byId = new Map(moveTree.map((node) => [node.id, node]));
  const line = new Map<string, MoveNode>();
  let node = byId.get("root");
  while (node?.children[0]) {
    const next = byId.get(node.children[0]);
    if (!next) break;
    line.set(next.id, next);
    node = next;
  }
  return line;
}

/**
 * The reviewed moves that still describe the game: on its main line, from the same position, with
 * the same move. Moves the analysis covered that were since deleted, replaced or moved into a
 * variation are left out, so the stats, the board and the commentary never use them. Returns
 * `moves` itself when every move still matches.
 */
export function compatibleReviewMoves(
  moves: MoveReview[],
  moveTree: readonly MoveNode[]
): MoveReview[] {
  if (!moves.length) return moves;
  const line = mainlineById(moveTree);
  const kept = moves.filter((move) => {
    const node = line.get(move.nodeId);
    return node !== undefined && node.uci === move.playedMove && node.fenBefore === move.fenBefore;
  });
  return kept.length === moves.length ? moves : kept;
}

/** Whether `line` (a running review's input) is still the start of the game's main line. */
export function lineStillOnMainline(
  line: readonly ReviewLineMove[],
  moveTree: readonly MoveNode[]
): boolean {
  const mainline = mainlineById(moveTree);
  return line.every((move) => mainline.get(move.nodeId)?.uci === move.uci);
}

/** The reviewed moves to display (see selectDisplayedMoves), without those the game no longer has. */
export function useDisplayedReviewMoves(): MoveReview[] {
  const moves = useReviewStore(selectDisplayedMoves);
  const moveTree = useGameStore((state) => state.moveTree);
  return useMemo(() => compatibleReviewMoves(moves, moveTree), [moveTree, moves]);
}

/** How many of the shown analysis's moves the game no longer has (0: it still matches). */
export function useOutdatedReviewMoves(): number {
  const review = useReviewStore((state) => (state.status === "running" ? null : state.review));
  const moveTree = useGameStore((state) => state.moveTree);
  return useMemo(
    () => (review ? review.moves.length - compatibleReviewMoves(review.moves, moveTree).length : 0),
    [moveTree, review]
  );
}
