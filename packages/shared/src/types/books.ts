/**
 * Chess book import (main/books): a PDF's pages are read by a vision model, turned into lines by
 * the user's OpenRouter model, merged into one move tree per book chapter and stored as a
 * repertoire named after the book, every move linked to the page it came from (`[%page N]`, see
 * books/book-page.ts). These are the shapes the renderer sees over IPC.
 */
import type { RepertoireColor } from "./repertoire";

/**
 * - `adding-pages`: created; the renderer is still sending page images.
 * - `ready`: every page is stored; nothing has run yet.
 * - `running`: an import is under way (stage and progress in `BookProgressEvent`).
 * - `paused`: cancelled, or the app closed while it ran; `resume` continues where it stopped
 *   (pages already read are never paid for again).
 * - `failed`: stopped on an error (`error` says why); `resume` tries again.
 * - `done`: the repertoire is written (`repertoireId`).
 */
export type BookStatus = "adding-pages" | "ready" | "running" | "paused" | "failed" | "done";

export const BOOK_STAGES = ["ocr", "outline", "lines", "repair", "write"] as const;
/** ocr: reading page images; outline: title, colour and chapters; lines: moves per page; repair: illegal lines fixed from the page image; write: the repertoire. */
export type BookStage = (typeof BOOK_STAGES)[number];

/** A line that is still illegal after repair (its legal start is kept). */
export type BookLineProblem = {
  /** 0-based page of the PDF. */
  pageIndex: number;
  /** The page number printed in the book, when it was read. */
  printedPage: number | null;
  label: string | null;
  error: string;
};

/** How well one book chapter was rebuilt. */
export type BookChapterReport = {
  /** Lines the model extracted (with at least one move). */
  lines: number;
  legalLines: number;
  illegalLines: BookLineProblem[];
  /** Lines rewritten by a repair (legal or not afterwards). */
  repairedLines: number;
  /** Moves in the chapter's tree. */
  moves: number;
  notesAnchored: number;
  notesUnanchored: number;
  /** Moves printed without the piece's origin ("Rd3" with two rooks) that only one reading kept legal. */
  disambiguated: number;
  /** Such moves still ambiguous after looking ahead: the nearest piece was taken (worth checking). */
  ambiguousGuesses: number;
  /** Moves printed on the chapter's pages (read from the page text) and how many the tree has. */
  coverage: { printed: number; found: number } | null;
  /** Pages whose lines couldn't be read (the model's answer was unusable twice). */
  unreadablePages: number[];
};

export type BookChapterSummary = {
  index: number;
  title: string;
  /** 0-based PDF pages, inclusive. */
  firstPageIndex: number;
  lastPageIndex: number;
  /** The repertoire chapter it became (null until written, or when it had no moves). */
  repertoireChapterId: string | null;
  report: BookChapterReport | null;
};

export type BookSummary = {
  id: string;
  /** The book's title (from its pages once read; until then the PDF's title or file name). */
  title: string;
  author: string | null;
  /** The side the book's repertoire is for (null until read). */
  color: RepertoireColor | null;
  sourceName: string;
  pageCount: number;
  /** Pages stored so far. */
  pagesAdded: number;
  status: BookStatus;
  /** The stage running, or the one it stopped at. */
  stage: BookStage | null;
  /** Why it failed (a sentence to show), null otherwise. */
  error: string | null;
  /** OpenRouter's charges so far, in USD. */
  costUsd: number;
  repertoireId: string | null;
  ocrModel: string;
  structureModel: string;
  chapters: BookChapterSummary[];
  createdAt: number;
  updatedAt: number;
};

/** Sent on every step of a running import, and when its status changes. */
export type BookProgressEvent = {
  bookId: string;
  status: BookStatus;
  stage: BookStage | null;
  /** Work done and to do in this stage (pages, lines, chapters). */
  done: number;
  total: number;
  costUsd: number;
  /** The chapter being read, during `lines`. */
  chapter: { index: number; title: string } | null;
  error: string | null;
};

export type BookEstimateInput = { pageCount: number };

export type BookEstimate = {
  pageCount: number;
  ocrModel: string;
  structureModel: string;
  /** Expected OpenRouter charges, in USD. */
  costUsd: number;
  /** Expected duration, in minutes. */
  minutes: number;
  /** Prices from OpenRouter's model list, or built-in ones when it couldn't be reached. */
  prices: "live" | "fallback";
};

export type CreateBookInput = {
  /** The PDF's file name (shown until the title is read). */
  sourceName: string;
  pageCount: number;
  /** The PDF's own title (its metadata), when it has one. */
  metadataTitle: string | null;
  /** SHA-256 of the PDF (hex): the same file again continues its import. */
  sha256: string;
};

/** One rendered page (WebP, PNG or JPEG bytes), 0-based. */
export type AddBookPageInput = { bookId: string; pageIndex: number; bytes: Uint8Array };

export type BookPage = {
  pageIndex: number;
  printedPage: number | null;
  /** The page image (`chaturanga-image:` URL); null when its file is missing. */
  src: string | null;
  /** The page as read (Markdown), null until read. */
  ocrText: string | null;
};

/** A repertoire's book pages (for showing the page beside its moves). */
export type BookPages = {
  bookId: string;
  title: string;
  pages: BookPage[];
};

/** Most pages a book may have. */
export const MAX_BOOK_PAGES = 2_000;
