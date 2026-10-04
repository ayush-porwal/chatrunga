import { parseOpeningBook, type OpeningBook } from "@chaturanga/shared/chess/opening-book";
import { OPENING_BOOK_DATA } from "@chaturanga/shared/chess/opening-book-data";

let book: OpeningBook | null = null;

/**
 * The bundled opening book (lichess-org/chess-openings), read on first use — a review, or a saved
 * one re-assessed when it opens — and kept for the session.
 */
export function openingBook(): OpeningBook {
  book ??= parseOpeningBook(OPENING_BOOK_DATA);
  return book;
}
