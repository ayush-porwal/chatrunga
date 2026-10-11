import { useMemo } from "react";
import { standardCastlingUci } from "@chaturanga/shared/chess/review";
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
    // The tree keeps a castle as imported (king takes rook, `e1h1`); a review stores it standard.
    return (
      node?.uci != null &&
      node.fenBefore === move.fenBefore &&
      standardCastlingUci(node.fenBefore, node.uci) === move.playedMove
    );
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

/**
 * How many full moves of the analysis the game no longer has, counted as the move numbers they
 * touch (White's move and Black's reply are one move), so a changed reply and the moves after it
 * read as moves, not plies. 0: it still matches.
 */
export function outdatedFullMoves(moves: MoveReview[], moveTree: readonly MoveNode[]): number {
  const kept = new Set(compatibleReviewMoves(moves, moveTree));
  const numbers = new Set<number>();
  // A ply counts from the game's real start (a Black-to-move position opens on an even ply), so
  // half of it, rounded up, is the move's own number.
  for (const move of moves) if (!kept.has(move)) numbers.add(Math.ceil(move.ply / 2));
  return numbers.size;
}

/** How many full moves of the shown analysis the game no longer has (outdatedFullMoves). */
export function useOutdatedReviewMoves(): number {
  const review = useReviewStore((state) => (state.status === "running" ? null : state.review));
  const moveTree = useGameStore((state) => state.moveTree);
  return useMemo(
    () => (review ? outdatedFullMoves(review.moves, moveTree) : 0),
    [moveTree, review]
  );
}
