import { annotationLabel, annotationOf } from "@chaturanga/shared/chess/move-assessment";
import { uciSquares } from "@chaturanga/shared/chess/square";
import type { Color, GameMode, GameSource, Square } from "@chaturanga/shared/types/chess";
import type { MoveAnnotation, MoveReview } from "@chaturanga/shared/types/engine";

/*
 * The review mark on the board: the badge on the destination square of the move that led to the
 * position shown, as chess.com draws it. Pure, so the boards only wire it up.
 */

/** A board that could show marks: Game review's board, or the main board in its current mode. */
export type MarkSurface = "review" | GameMode;

/** The badge to draw: the move's mark on its destination square. */
export type BoardMoveMark = {
  /** The move it marks (the badge appears afresh for each move). */
  nodeId: string;
  square: Square;
  annotation: MoveAnnotation;
  /** The badge's accessible name: "Blunder: Nxe5". */
  label: string;
};

/**
 * The main board's surface: the Analyze board is live analysis, or the board the sidebar's Analyze
 * opens (a free board of the game, engine not started yet); any other mode is itself.
 */
export function mainBoardSurface(mode: GameMode, source: GameSource): MarkSurface {
  return mode === "freeplay" && source === "analysis" ? "analysis" : mode;
}

/**
 * Marks show only where a reviewed game is studied: Game review, and the Analyze board. Never
 * while playing (a free board, an engine or Lichess game) or solving a puzzle, where they would
 * judge or give away moves.
 */
export function showsMoveMarks(surface: MarkSurface): boolean {
  return surface === "review" || surface === "analysis";
}

/**
 * The mark of the move at `nodeId`, or null: on a surface without marks, and for a move the review
 * doesn't cover or didn't mark (ordinary moves stay unmarked). A book move gets its badge like any
 * other mark. `moves` are the reviewed moves the game still has (compatibleReviewMoves), so a move
 * changed since the analysis gets no badge; while a review runs, they are the moves analysed so far:
 * a finished move's mark is final, so it shows at once, and a move not analysed yet has none.
 */
export function boardMoveMark(
  surface: MarkSurface,
  { moves, nodeId }: { moves: readonly MoveReview[]; nodeId: string }
): BoardMoveMark | null {
  if (!showsMoveMarks(surface)) return null;
  const move = moves.find((item) => item.nodeId === nodeId);
  const annotation = annotationOf(move);
  const squares = move ? uciSquares(move.playedMove) : null;
  if (!move || !annotation || !squares) return null;
  return {
    nodeId,
    square: squares[1],
    annotation,
    label: `${annotationLabel(annotation)}: ${move.san}`
  };
}

/**
 * Where `square` sits on a board seen from `orientation`, as percentages of the board's edge from
 * its left and top (each square is 12.5%), so the badge follows the board through any resize.
 */
export function squareOffset(square: Square, orientation: Color): { left: number; top: number } {
  const file = square.charCodeAt(0) - "a".charCodeAt(0);
  const rank = Number(square[1]) - 1;
  return orientation === "white"
    ? { left: file * 12.5, top: (7 - rank) * 12.5 }
    : { left: (7 - file) * 12.5, top: rank * 12.5 };
}
