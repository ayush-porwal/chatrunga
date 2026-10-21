/**
 * The book import's prompts (main/books/import-job.ts): reading a page image (OCR), the book's
 * outline, one page's lines, and repairing an illegal line from its page image. Answers are
 * checked by llm-output.ts.
 */
import type { RepertoireColor } from "../types/repertoire";
import type { BookGame } from "./llm-output";

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type BookChatMessage = {
  role: "system" | "user";
  content: string | ChatContentPart[];
};

export const BOOK_OCR_PROMPT = `You are transcribing one scanned page of a chess book (figurine algebraic notation) into Markdown.

Rules:
- Reading order: if the page has two text columns, transcribe the whole LEFT column top to bottom, then the whole RIGHT column. A chapter title block spanning both columns comes first.
- Piece figurines become English SAN letters: king K, queen Q, rook R, bishop B, knight N. Pawns have no letter. Castling is 0-0 / 0-0-0 exactly as printed.
- Keep move numbers exactly as printed ("15 Rd2 Rc5", "15...Rfd8", "15 ... Rfd8"). Do not add dots, do not renumber, do not "fix" moves.
- Bold move text (the main line) is wrapped in **double asterisks**. Italic text is wrapped in *single asterisks*.
- Keep annotation symbols exactly: ! ? !! ?? !? ?! + # = ± ∓ +- -+ ∞ and so on.
- Keep variation labels exactly as printed: a), b), a1), b21) etc., each starting a new line.
- Each chess diagram becomes a line "[DIAGRAM]" at the place it appears in the column.
- Omit the running header (book title / chapter title at the top of the page). Put the printed page number on the last line as "[PAGE n]" (or "[PAGE ?]" when none is printed).
- Output only the transcription, no commentary.`;

/** One page image to read (a `data:` URL). */
export function bookOcrMessages(imageUrl: string): BookChatMessage[] {
  return [
    {
      role: "user",
      content: [
        { type: "text", text: BOOK_OCR_PROMPT },
        { type: "image_url", image_url: { url: imageUrl } }
      ]
    }
  ];
}

export const BOOK_OUTLINE_PROMPT = `You read the first pages of a chess book (title page, contents, introduction) and describe the book so a program can split it into chapters.

Output ONE JSON object:
{
  "title": string,                 // the book's title as printed (with its subtitle only if short)
  "author": string | null,
  "color": "white" | "black",      // the side whose repertoire the book builds (whose moves the author recommends)
  "printedPageOffset": number,     // PDF page number minus printed page number (PDF pages start at 1)
  "chapters": [
    { "number": number | null, "title": string, "firstPage": number, "lastPage": number | null }
  ]
}

Rules:
- List, in order, every chapter (and complete illustrative game section) that contains chess moves, with its printed first page from the table of contents. Skip the foreword, bibliography, index and similar.
- lastPage is the chapter's last printed page when the contents make it clear, else null.
- Work out printedPageOffset from a page whose printed number ("[PAGE n]") you can see next to its PDF page number.`;

/** The outline request: the PDF's own title and the first pages as read. */
export function bookOutlineMessages(input: {
  metadataTitle: string | null;
  pages: readonly { pdfPage: number; text: string }[];
}): BookChatMessage[] {
  const pages = input.pages.map((page) => `=== PDF PAGE ${page.pdfPage} ===\n${page.text}`);
  return [
    { role: "system", content: BOOK_OUTLINE_PROMPT },
    {
      role: "user",
      content: `PDF TITLE: ${input.metadataTitle ?? "(none)"}\n\n${pages.join("\n\n")}`
    }
  ];
}

export type BookContext = { title: string; author: string | null; color: RepertoireColor };

/** The lines prompt for a book (its title and side). */
export function bookLinesPrompt(book: BookContext): string {
  const side = book.color.toUpperCase();
  const opponent = book.color === "white" ? "BLACK" : "WHITE";
  const byline = book.author ? ` by ${book.author}` : "";
  return `You extract chess lines from ONE page of a chess opening book so a program can rebuild the full variation tree.

Book: "${book.title}"${byline}, a repertoire for ${side}. Pieces are English SAN letters (K Q R B N). Bold (**...**) text is the game/main line. Labels a), b), a1), b2) start sub-variations; a variation branches from the position BEFORE the move it replaces. Text in parentheses inside a variation is a sub-line branching from that variation. "15...Rfd8" is Black's 15th move. OCR may drop a piece letter ("9...e7" for "9...Be7") or misread one: always choose the LEGAL reading that fits the context.

You get: CONTEXT (where the book is: the current game header and its main line so far, as SAN from move 1), the END OF THE PREVIOUS PAGE, and THIS PAGE. Extract every move printed on THIS PAGE.

Output ONE JSON object:
{
  "game": null | { "white": string, "black": string, "event": string, "year": string },   // only when a NEW complete game starts on this page
  "lines": [
    {
      "label": string | null,          // "a2", "b", null for the main line
      "kind": "main" | "variation",
      "role": "own-recommended" | "own-alternative" | "opponent",
        // own-recommended: the author's choice for ${side} (main line or a ${side} improvement he advises)
        // own-alternative: a ${side} try the author rejects or only mentions in passing
        // opponent: a ${opponent} alternative (always prepared for)
      "moves": string,                 // FULL SAN movetext from the initial position, e.g. "1. e4 c5 2. Nf3 d6 ... 12... Rc8 13. Rxc8+ Qxc8". Must be legal chess.
      "notes": [ { "after": string, "text": string, "symbols": string | null } ]
        // after: a move token that occurs in "moves" with its number, e.g. "13. Rxc8+" or "12... Rc8"
        // text: the author's explanation for that move, faithful and concise (trim filler)
        // symbols: annotation/eval symbols printed with the move, e.g. "!?", "?!", "!", "±", "=", "+-", or null
    }
  ]
}

Rules:
- One entry per distinct line. The main line entry contains the game moves printed on this page, prefixed by the moves before them. A line that continues from the previous page is output again in full.
- Include every move of every sub-line on this page, as deep as printed. Never invent moves. Never skip a variation.
- Every line's "moves" starts with "1." from the initial position and is the exact path to the line's last move.`;
}

/** Where the book is when a page is read: the game being annotated and its main line so far. */
export type BookLinesContext = { game: BookGame | null; mainLine: string | null };

/** One page's lines request. `previousPage`: the end of the page before (null at a chapter's start). */
export function bookLinesMessages(input: {
  book: BookContext;
  context: BookLinesContext;
  previousPage: string | null;
  page: string;
}): BookChatMessage[] {
  const { game, mainLine } = input.context;
  const header = game
    ? `${game.white} - ${game.black}, ${[game.event, game.year].filter(Boolean).join(" ")}`
    : "(none yet: chapter introduction)";
  const context = `Current game: ${header}\nMain line so far: ${mainLine ?? "(none)"}`;
  return [
    { role: "system", content: bookLinesPrompt(input.book) },
    {
      role: "user",
      content: `CONTEXT\n${context}\n\nEND OF THE PREVIOUS PAGE\n${input.previousPage ?? "(chapter start)"}\n\nTHIS PAGE\n${input.page}`
    }
  ];
}

/** How much of the previous page the lines prompt sees. */
export const PREVIOUS_PAGE_TAIL = 1_500;

export const BOOK_REPAIR_PROMPT = `A line extracted from a scanned chess book page is illegal at one move (OCR misread a piece, dropped a disambiguation letter, or a move was mis-copied). Look at the page image and fix the line so it is legal chess and matches what the book prints.

Output ONE JSON object: { "moves": string }  — the FULL corrected SAN movetext from move 1 (same format as the input line), or { "moves": null } if the book really cannot be read as a legal line.
Change as little as possible: usually only the failing move (and the moves after it if they were shifted).`;

/** A repair request: the line, what failed, the position before it and the page images. */
export function bookRepairMessages(input: {
  label: string | null;
  printedPage: number | null;
  moves: string;
  error: string;
  fenBefore: string;
  legalSans: readonly string[];
  /** The page's image first, then the previous page's (`data:` URLs). */
  images: readonly string[];
}): BookChatMessage[] {
  const page = input.printedPage === null ? "" : `, book page ${input.printedPage}`;
  const text = `${BOOK_REPAIR_PROMPT}

LINE (label ${input.label ?? "main"}${page}):
${input.moves}

PROBLEM: ${input.error.replace(/ after .*/, "")}
POSITION BEFORE IT (FEN): ${input.fenBefore}
LEGAL MOVES THERE: ${input.legalSans.join(" ")}

The page image (and the previous page) follow.`;
  return [
    {
      role: "user",
      content: [
        { type: "text", text },
        ...input.images.map((url) => ({ type: "image_url" as const, image_url: { url } }))
      ]
    }
  ];
}
