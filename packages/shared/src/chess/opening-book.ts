/**
 * The opening book: every position on the named lines of lichess-org/chess-openings (the data in
 * opening-book-data.ts), keyed by EPD, so a game is in the book by its position whatever move
 * order reached it (a transposition). A book move is one whose resulting position is in the book;
 * the game's opening is the deepest named position it reached with one.
 *
 * Pure: main reads the bundled data once (parseOpeningBook) and passes the book in.
 */
import type { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import type { GameOpening, MoveReview } from "../types/engine";
import { positionFromFen, START_FEN } from "./position";

export type OpeningName = { eco: string; name: string };

/**
 * The book's positions by EPD (positionKey): the opening's name for a named position, null for a
 * position on the way to one (the data names a line where it ends, not at every move).
 */
export type OpeningBook = ReadonlyMap<string, OpeningName | null>;

function epdOf(pos: Chess): string {
  // chessops writes an en passant square only when the capture is legal, as the data's EPDs do.
  return makeFen(pos.toSetup(), { epd: true });
}

/** A position's book key: its EPD (no move counters; en passant only when legal). Null: bad FEN. */
export function positionKey(fen: string): string | null {
  try {
    return epdOf(positionFromFen(fen));
  } catch {
    return null;
  }
}

/**
 * Reads the book's move tree (one "<depth>\t<uci>[\t<eco>\t<name>]" row per
 * move, depth-first). The start position is in the book, unnamed. Throws on a malformed row.
 */
export function parseOpeningBook(data: string): OpeningBook {
  const start = positionFromFen(START_FEN);
  const book = new Map<string, OpeningName | null>([[epdOf(start), null]]);
  // The positions along the current line, by depth (0: the start).
  const line: Chess[] = [start];
  for (const row of data.split("\n")) {
    if (!row) continue;
    const [depthText = "", uci = "", eco, name] = row.split("\t");
    const depth = Number(depthText);
    const parent = Number.isInteger(depth) && depth > 0 ? line[depth - 1] : undefined;
    const move = parseUci(uci);
    if (!parent || !move || !parent.isLegal(move)) throw new Error(`Bad opening book row: ${row}`);
    const pos = parent.clone();
    pos.play(move);
    line.length = depth;
    line.push(pos);
    const key = epdOf(pos);
    if (eco && name) book.set(key, { eco, name });
    else if (!book.has(key)) book.set(key, null);
  }
  return book;
}

/** The named opening at `fen`, or null (not in the book, or on the way to a named position). */
export function openingAt(book: OpeningBook, fen: string): OpeningName | null {
  const key = positionKey(fen);
  return key === null ? null : (book.get(key) ?? null);
}

export function inBook(book: OpeningBook, fen: string): boolean {
  const key = positionKey(fen);
  return key !== null && book.has(key);
}

/** What the classification reads from a game's main-line moves. */
export type BookLineMove = Pick<MoveReview, "ply" | "san" | "fenAfter">;

export type OpeningClassification = {
  /**
   * Per move (by index): a book move, one whose resulting position is in the book. A move order
   * the data doesn't list still counts once it reaches a book position (a transposition), so a
   * game can step out of the book for a move and back in.
   */
  book: boolean[];
  /** The deepest named position the game reached with a book move (null: none). */
  opening: GameOpening | null;
};

/** Classifies a game's main line, its moves in order. */
export function classifyOpening(
  book: OpeningBook,
  moves: readonly BookLineMove[]
): OpeningClassification {
  const inLine = moves.map((move) => inBook(book, move.fenAfter));
  const last = inLine.lastIndexOf(true);
  // The deepest named position among the book moves.
  let named: { move: BookLineMove; name: OpeningName } | null = null;
  for (let index = last; index >= 0 && !named; index -= 1) {
    const move = moves[index];
    const name = move && inLine[index] ? openingAt(book, move.fenAfter) : null;
    if (move && name) named = { move, name };
  }
  const end = moves[last];
  if (!named || !end) return { book: inLine, opening: null };
  const next = moves[last + 1];
  return {
    book: inLine,
    opening: {
      eco: named.name.eco,
      name: named.name.name,
      ply: named.move.ply,
      bookEndPly: end.ply,
      firstNonBookMove: next ? { ply: next.ply, san: next.san } : null
    }
  };
}
