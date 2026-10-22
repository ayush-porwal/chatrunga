import { bookPageOf, stripBookPage } from "@chaturanga/shared/books/book-page";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { ERROR_MARKS, type MoveReview } from "@chaturanga/shared/types/engine";
import { uciLineSteps, type LineStep } from "../game-review/review-utils";
import type { TreeModel, VariationRow } from "./move-tree-model";

/*
 * The move list's pure parts: each move's piece and bare SAN, the BEST line under a marked error,
 * which of those lines are unfolded, and the order of the list's rows. TreeView draws them.
 */

/** The pieces a move list draws (Chessground's role names, so the board's sprites draw them). */
export type MovePieceRole = "pawn" | "knight" | "bishop" | "rook" | "queen" | "king";

const SAN_ROLES: Partial<Record<string, MovePieceRole>> = {
  K: "king",
  Q: "queen",
  R: "rook",
  B: "bishop",
  N: "knight"
};

/** The piece a SAN move moves: its leading letter, the king for castling, else a pawn. */
export function sanPiece(san: string): MovePieceRole {
  if (san.startsWith("O-O")) return "king";
  return SAN_ROLES[san.charAt(0)] ?? "pawn";
}

/** The SAN without its piece letter (`Nxe5` → `xe5`), drawn after the piece's icon. */
export function bareSan(san: string): string {
  return SAN_ROLES[san.charAt(0)] ? san.slice(1) : san;
}

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
const BEST_LINE_PLIES = 4;

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

/** The BEST-line preview board's edge bounds (CSS px). */
export const PREVIEW_BOARD_MIN = 200;
const PREVIEW_BOARD_MAX = 340;
/** The preview never outgrows this share of the main board. */
const PREVIEW_BOARD_SHARE = 0.6;

/** A preview board's bounds: its edge in CSS px, and the share of the main board it stays under. */
export type PreviewBoardBounds = { min: number; max: number; share: number };

/** The BEST line's preview (the move tree's). */
export const BEST_LINE_PREVIEW: PreviewBoardBounds = {
  min: PREVIEW_BOARD_MIN,
  max: PREVIEW_BOARD_MAX,
  share: PREVIEW_BOARD_SHARE
};

/** An engine line's preview (the Moves tab's engine): about three quarters of the BEST line's. */
export const ENGINE_LINE_PREVIEW: PreviewBoardBounds = { min: 150, max: 255, share: 0.45 };

/**
 * The edge of a line's preview board: as wide as the panel allows, at most `max` and `share` of
 * the main board (so a wide panel beside a shrunk board never shows a preview bigger than the
 * board), at least `min`, and never wider than the room it has. By default a BEST line's: 340px,
 * 60%, 200px.
 */
export function previewBoardSize(
  available: number,
  mainBoard: number | null,
  bounds: PreviewBoardBounds = BEST_LINE_PREVIEW
): number {
  const cap = Math.min(
    bounds.max,
    mainBoard && mainBoard > 0 ? mainBoard * bounds.share : bounds.max
  );
  const size = Math.min(available, Math.max(bounds.min, cap));
  return Math.max(0, Math.floor(size));
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
  /** A variation's line row (one per line; nested lines follow their parent, one deeper). */
  | { kind: "variation"; row: VariationRow }
  /**
   * A move's comment under the row holding the move (`showComments`). `move` names the move
   * ("4… Qg5") where the row holds others; null for the only commented move of a main-line pair.
   * `text` is the comment without its book page command; `page` is that page (1-based PDF page)
   * where the move starts a book page and pages are shown (`bookPages`), else null.
   */
  | {
      kind: "comment";
      node: MoveNode;
      depth: number;
      move: string | null;
      text: string | null;
      page: number | null;
    };

/**
 * The main line's rows: each move pair (then its moves' comments, with `showComments`), then the
 * opening row when the pair holds the last book move, then the unfolded BEST lines of its moves
 * (White's, Black's), then the variations played instead of its moves (White's, Black's), each
 * followed by its comments and the variations nested in it.
 */
export function mainlineItems(
  model: TreeModel,
  {
    bookEndNodeId = null,
    showsBestLine = () => false,
    showComments = false,
    bookPages = false
  }: {
    bookEndNodeId?: string | null;
    /** Whether the move's BEST line is drawn (it has one and it is unfolded). */
    showsBestLine?: (node: MoveNode) => boolean;
    /** Each move's comment under the row holding the move. */
    showComments?: boolean;
    /** With `showComments`: a move that starts a book page (`[%page N]`) gets a row for its page. */
    bookPages?: boolean;
  } = {}
): MoveListItem[] {
  const items: MoveListItem[] = [];
  const noteOf = (node: MoveNode | undefined) => commentNote(node, bookPages);
  for (const row of model.mainline) {
    items.push({ kind: "moves", number: row.number, white: row.white, black: row.black });
    const moves = [row.white, row.black].filter((node): node is MoveNode => Boolean(node));
    if (showComments) items.push(...pairComments(row.number, row.white, row.black, noteOf));
    const bookEnd = moves.find((node) => node.id === bookEndNodeId);
    if (bookEnd) items.push({ kind: "opening", afterNodeId: bookEnd.id });
    for (const node of moves) if (showsBestLine(node)) items.push({ kind: "best", node });
    for (const node of moves)
      for (const variation of model.variationsByMove.get(node.id) ?? []) {
        items.push({ kind: "variation", row: variation });
        if (showComments) items.push(...variationComments(variation, noteOf));
      }
  }
  return items;
}

type CommentNote = { text: string | null; page: number | null };

/**
 * What a move's comment row shows: its text without the book page command (which is never shown
 * as text), and the page it starts where pages are shown. Null when there is nothing to show.
 */
function commentNote(node: MoveNode | undefined, bookPages: boolean): CommentNote | null {
  const comment = node?.comment;
  if (!comment) return null;
  const text = stripBookPage(comment);
  const page = bookPages ? bookPageOf(comment) : null;
  return text || page !== null ? { text, page } : null;
}

/** A main-line pair's comments, White's then Black's (each named when both have one). */
function pairComments(
  number: number,
  white: MoveNode | undefined,
  black: MoveNode | undefined,
  noteOf: (node: MoveNode | undefined) => CommentNote | null
): MoveListItem[] {
  const whiteNote = noteOf(white);
  const blackNote = noteOf(black);
  const both = Boolean(whiteNote && blackNote);
  const items: MoveListItem[] = [];
  if (white && whiteNote) {
    items.push({
      kind: "comment",
      node: white,
      depth: 0,
      move: both ? `${number}. ${white.san}` : null,
      ...whiteNote
    });
  }
  if (black && blackNote) {
    items.push({
      kind: "comment",
      node: black,
      depth: 0,
      move: both ? `${number}… ${black.san}` : null,
      ...blackNote
    });
  }
  return items;
}

/** A variation's comments, each named by its move (the line holds several). */
function variationComments(
  row: VariationRow,
  noteOf: (node: MoveNode | undefined) => CommentNote | null
): MoveListItem[] {
  return row.moves.flatMap(({ node, number }) => {
    const note = noteOf(node);
    if (!note) return [];
    return [
      {
        kind: "comment" as const,
        node,
        depth: row.depth,
        move: [number, node.san].filter(Boolean).join(" "),
        ...note
      }
    ];
  });
}
