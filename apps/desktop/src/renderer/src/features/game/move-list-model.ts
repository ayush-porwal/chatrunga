import type { MoveNode } from "@chaturanga/shared/types/chess";
import type { MoveAnnotation, MoveReview } from "@chaturanga/shared/types/engine";
import { uciLineSteps, type LineStep } from "../game-review/review-utils";
import type { TreeModel, TreeVariationBlock } from "./move-tree-model";

/*
 * The move list's pure parts: each move's piece and bare SAN, the BEST line under a marked error,
 * which of those lines are unfolded, and the order of the list's rows. TreeView draws them.
 */

/** The pieces a move list draws (Chessground's role names, so the board's sprites draw them). */
export type MovePieceRole = "pawn" | "knight" | "bishop" | "rook" | "queen" | "king";

const SAN_ROLES: Record<string, MovePieceRole> = {
  K: "king",
  Q: "queen",
  R: "rook",
  B: "bishop",
  N: "knight"
};

/** The piece a SAN move moves: its leading letter, the king for castling, else a pawn. */
export function sanPiece(san: string): MovePieceRole {
  if (san.startsWith("O-O")) return "king";
  return SAN_ROLES[san[0] ?? ""] ?? "pawn";
}

/** The SAN without its piece letter (`Nxe5` → `xe5`), drawn after the piece's icon. */
export function bareSan(san: string): string {
  return SAN_ROLES[san[0] ?? ""] ? san.slice(1) : san;
}

/** The marks that say a better move was there: their BEST line shows what it was. */
const ERROR_MARKS: ReadonlySet<MoveAnnotation> = new Set([
  "inaccuracy",
  "mistake",
  "blunder",
  "miss"
]);

/** The engine's best line from before a reviewed move (UCI), or just its best move. */
function bestUcis(review: MoveReview): readonly string[] {
  if (review.bestLine.length) return review.bestLine;
  return review.bestMove ? [review.bestMove] : [];
}

/**
 * Whether the move gets a BEST line: it is marked as an error and the engine preferred another
 * move (a line starting with the move played would teach nothing).
 */
export function hasBestLine(review: MoveReview | undefined): review is MoveReview {
  const annotation = review?.assessment?.annotation;
  if (!review || !annotation || !ERROR_MARKS.has(annotation)) return false;
  const first = bestUcis(review)[0];
  return Boolean(first) && first !== review.playedMove;
}

/** The most moves of a BEST line shown (the decided look: the best move and three more). */
export const BEST_LINE_PLIES = 4;

/** One move of a BEST line, with the number written before it (`12…`, `13.` or none). */
export type BestLineMove = LineStep & { number: string | null };

/**
 * `12.` before White's moves, `12…` before Black's first one, nothing before Black's others, for
 * the `index`-th move of a line played from `fen`.
 */
export function lineMoveNumber(fen: string, index: number): string | null {
  const [, turn = "w", , , , fullmove = "1"] = fen.split(" ");
  const whiteFirst = turn === "w";
  const white = whiteFirst ? index % 2 === 0 : index % 2 === 1;
  const number = (Number(fullmove) || 1) + Math.floor((index + (whiteFirst ? 0 : 1)) / 2);
  if (white) return `${number}.`;
  return index === 0 ? `${number}…` : null;
}

/**
 * The BEST line of a marked error: the engine's line from the position before it, cut at
 * {@link BEST_LINE_PLIES} and at the first move that doesn't fit. Empty when it has none.
 */
export function bestLineMoves(review: MoveReview, plies = BEST_LINE_PLIES): BestLineMove[] {
  if (!hasBestLine(review)) return [];
  return uciLineSteps(review.fenBefore, bestUcis(review).slice(0, plies)).map((step, index) => ({
    ...step,
    number: lineMoveNumber(review.fenBefore, index)
  }));
}

/** The line as text, as it reads on screen: `12… Nc5 13. Nd2 a4 14. f4`. */
export function bestLineText(moves: readonly BestLineMove[]): string {
  return moves.map((move) => (move.number ? `${move.number} ${move.san}` : move.san)).join(" ");
}

/**
 * Which BEST lines are unfolded: every line follows the list-wide choice (`showAll`, which is
 * remembered) except the ones toggled one by one since (`toggled`).
 */
export type LineFolds = { showAll: boolean; toggled: ReadonlySet<string> };

export function lineUnfolded(folds: LineFolds, nodeId: string): boolean {
  return folds.showAll !== folds.toggled.has(nodeId);
}

/** Folds or unfolds one move's line. */
export function toggleLineFold(folds: LineFolds, nodeId: string): LineFolds {
  const toggled = new Set(folds.toggled);
  if (!toggled.delete(nodeId)) toggled.add(nodeId);
  return { showAll: folds.showAll, toggled };
}

/** "Show all lines" / "Hide all lines": every line follows it again. */
export function setAllLineFolds(showAll: boolean): LineFolds {
  return { showAll, toggled: new Set() };
}

/** One row of the list's main line section, in the order they are drawn. */
export type MoveListItem =
  | { kind: "moves"; number: number; white?: MoveNode; black?: MoveNode }
  /** "📖 A28 English Opening: Four Knights System … book ends", after the last book move. */
  | { kind: "opening"; afterNodeId: string }
  /** The BEST line under a marked error (only while it is unfolded). */
  | { kind: "best"; node: MoveNode }
  | { kind: "variations"; parentId: string; blocks: TreeVariationBlock[] };

/**
 * The main line's rows: each move pair, then the opening row when the pair holds the last book
 * move, then the unfolded BEST lines of its moves (White's, Black's), then the variations that
 * branch off its moves.
 */
export function mainlineItems(
  model: TreeModel,
  {
    bookEndNodeId = null,
    showsBestLine = () => false
  }: {
    bookEndNodeId?: string | null;
    /** Whether the move's BEST line is drawn (it has one and it is unfolded). */
    showsBestLine?: (node: MoveNode) => boolean;
  } = {}
): MoveListItem[] {
  const items: MoveListItem[] = [];
  for (const row of model.mainline) {
    items.push({ kind: "moves", number: row.number, white: row.white, black: row.black });
    const moves = [row.white, row.black].filter((node): node is MoveNode => Boolean(node));
    const bookEnd = moves.find((node) => node.id === bookEndNodeId);
    if (bookEnd) items.push({ kind: "opening", afterNodeId: bookEnd.id });
    for (const node of moves) if (showsBestLine(node)) items.push({ kind: "best", node });
    for (const node of moves) {
      const blocks = model.variationsByParent.get(node.id);
      if (blocks?.length) items.push({ kind: "variations", parentId: node.id, blocks });
    }
  }
  return items;
}
