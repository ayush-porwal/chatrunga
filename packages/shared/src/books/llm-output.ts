/**
 * What the models answer during a book import (prompts.ts), checked field by field: an answer is
 * data from outside, so nothing is cast. A malformed line or note is dropped rather than failing
 * its page; an answer without the expected shape throws `BookOutputError`.
 */
import { isOneOf, isRecord } from "../types/guards";
import type { RepertoireColor } from "../types/repertoire";

/** Whose line it is, from the repertoire's side (the book's colour). */
export const BOOK_LINE_ROLES = ["own-recommended", "own-alternative", "opponent"] as const;
/**
 * - `own-recommended`: the author's choice for the repertoire side (main line, or an improvement).
 * - `own-alternative`: a move of the repertoire side the author rejects or only mentions.
 * - `opponent`: an opponent's alternative (always prepared for).
 */
export type BookLineRole = (typeof BOOK_LINE_ROLES)[number];

export type BookGame = { white: string; black: string; event: string; year: string };

export type BookNote = {
  /** The move it follows, with its number ("13. Rxc8+", "12... Rc8"). */
  after: string;
  text: string;
  /** Annotation symbols printed with the move ("!?", "±"), or null. */
  symbols: string | null;
};

export type BookLine = {
  label: string | null;
  kind: "main" | "variation";
  role: BookLineRole;
  /** SAN movetext from the initial position. */
  moves: string;
  notes: BookNote[];
  /** The movetext before a repair rewrote it. */
  repairedFrom?: string;
  /** Repairs tried on this line (at most two). */
  repairAttempts?: number;
  /**
   * Set when another line's repair was carried over to this one (the model never saw it): what
   * changed and where it was repaired, so the chapter report can ask for a check.
   */
  carriedFix?: string;
};

/** One page's lines. `game`: a complete game starting on this page. */
export type BookPageLines = { game: BookGame | null; lines: BookLine[] };

export type BookOutlineChapter = {
  number: number | null;
  title: string;
  /** Printed page numbers (lastPage null: up to the next chapter). */
  firstPage: number;
  lastPage: number | null;
};

export type BookOutline = {
  title: string;
  author: string | null;
  color: RepertoireColor;
  /** PDF page = printed page + offset (1-based PDF pages). */
  printedPageOffset: number;
  chapters: BookOutlineChapter[];
};

/** A repaired line's full movetext, or null when the book can't be read as a legal line. */
export type BookRepair = { moves: string | null };

export class BookOutputError extends Error {}

const MAX_LINES = 300;
const MAX_NOTES = 200;
const MAX_MOVETEXT = 20_000;
const MAX_NOTE = 4_000;
const MAX_LABEL = 24;
const MAX_NAME = 200;
const MAX_CHAPTERS = 300;
const MAX_PAGE = 100_000;

/**
 * The JSON object in a model's answer: from the first `{` to the last `}` (models sometimes wrap
 * it in a code fence or a sentence). Throws when there is none or it doesn't parse.
 */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new BookOutputError("The answer has no JSON object.");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new BookOutputError("The answer's JSON doesn't parse.");
  }
}

/** Trimmed text of at most `max` characters, or null when it isn't a non-blank string. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** A whole number in [min, max], or null. Numbers written as text ("41") count. */
function wholeNumber(value: unknown, min: number, max: number): number | null {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof number === "number" && Number.isInteger(number) && number >= min && number <= max
    ? number
    : null;
}

function parseGame(value: unknown): BookGame | null {
  if (!isRecord(value)) return null;
  const white = text(value.white, MAX_NAME);
  const black = text(value.black, MAX_NAME);
  if (!white || !black) return null;
  const year = typeof value.year === "number" ? String(value.year) : text(value.year, 16);
  return { white, black, event: text(value.event, MAX_NAME) ?? "", year: year ?? "" };
}

function parseNote(value: unknown): BookNote | null {
  if (!isRecord(value)) return null;
  const after = text(value.after, 64);
  if (!after) return null;
  const symbols = text(value.symbols, 16);
  const note = text(value.text, MAX_NOTE) ?? "";
  if (!note && !symbols) return null;
  return { after, text: note, symbols };
}

/**
 * A role as the models write it. Older wording ("recommended", "alternative", "black-option")
 * maps to the repertoire's side; anything else reads as the author's recommendation on a main
 * line and as an opponent's option on a variation.
 */
function parseRole(value: unknown, kind: BookLine["kind"]): BookLineRole {
  if (isOneOf(BOOK_LINE_ROLES, value)) return value;
  if (value === "recommended") return "own-recommended";
  if (value === "alternative") return "own-alternative";
  return kind === "main" ? "own-recommended" : "opponent";
}

/** A line; its repair history only when `stored` (a model's answer never sets it). */
function parseLine(value: unknown, stored: boolean): BookLine | null {
  if (!isRecord(value)) return null;
  const moves = text(value.moves, MAX_MOVETEXT);
  if (!moves) return null;
  const kind = value.kind === "main" ? "main" : "variation";
  const notes = Array.isArray(value.notes)
    ? value.notes
        .slice(0, MAX_NOTES)
        .map(parseNote)
        .filter((note) => note !== null)
    : [];
  const line: BookLine = {
    label: text(value.label, MAX_LABEL),
    kind,
    role: parseRole(value.role, kind),
    moves,
    notes
  };
  if (!stored) return line;
  const repairedFrom = text(value.repairedFrom, MAX_MOVETEXT);
  if (repairedFrom) line.repairedFrom = repairedFrom;
  const attempts = wholeNumber(value.repairAttempts, 1, 10);
  if (attempts !== null) line.repairAttempts = attempts;
  const carriedFix = text(value.carriedFix, MAX_MOVETEXT);
  if (carriedFix) line.carriedFix = carriedFix;
  return line;
}

function parseLines(value: unknown, stored: boolean): BookPageLines {
  if (!isRecord(value) || !Array.isArray(value.lines)) {
    throw new BookOutputError("The answer has no list of lines.");
  }
  return {
    game: parseGame(value.game),
    lines: value.lines
      .slice(0, MAX_LINES)
      .map((line) => parseLine(line, stored))
      .filter((line) => line !== null)
  };
}

/**
 * The lines prompt's answer for one page. A repair history in it is ignored: only the repair
 * stage (import-job.ts) records one.
 */
export function parsePageLines(value: unknown): BookPageLines {
  return parseLines(value, false);
}

/** One page's lines as the import stored them, with each line's repair history. */
export function parseStoredPageLines(value: unknown): BookPageLines {
  return parseLines(value, true);
}

function parseOutlineChapter(value: unknown): BookOutlineChapter | null {
  if (!isRecord(value)) return null;
  const title = text(value.title, MAX_NAME);
  const firstPage = wholeNumber(value.firstPage, 1, MAX_PAGE);
  if (!title || firstPage === null) return null;
  const lastPage = wholeNumber(value.lastPage, firstPage, MAX_PAGE);
  return { number: wholeNumber(value.number, 0, 10_000), title, firstPage, lastPage };
}

/** The outline prompt's answer: the book's title, author, colour, page offset and chapters. */
export function parseBookOutline(value: unknown): BookOutline {
  if (!isRecord(value)) throw new BookOutputError("The outline isn't an object.");
  const title = text(value.title, MAX_NAME);
  if (!title) throw new BookOutputError("The outline has no title.");
  const color = typeof value.color === "string" ? value.color.trim().toLowerCase() : "";
  if (color !== "white" && color !== "black") {
    throw new BookOutputError("The outline doesn't say which side the book is for.");
  }
  const chapters = Array.isArray(value.chapters)
    ? value.chapters
        .slice(0, MAX_CHAPTERS)
        .map(parseOutlineChapter)
        .filter((chapter) => chapter !== null)
    : [];
  return {
    title,
    author: text(value.author, MAX_NAME),
    color,
    printedPageOffset: wholeNumber(value.printedPageOffset, -MAX_PAGE, MAX_PAGE) ?? 0,
    chapters
  };
}

/** The repair prompt's answer. */
export function parseBookRepair(value: unknown): BookRepair {
  if (!isRecord(value) || !("moves" in value)) {
    throw new BookOutputError("The repair has no moves.");
  }
  return { moves: text(value.moves, MAX_MOVETEXT) };
}
