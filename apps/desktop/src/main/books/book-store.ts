/**
 * The imported books' rows (migration 13): the book and its import's state, each page (image
 * file, text as read, lines) and each chapter (its pages, the repertoire chapter it became and its
 * report). Pages' text and lines are written as soon as they are read, so a resumed import only
 * asks for what is missing.
 */
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  parseBookOutline,
  parsePageLines,
  type BookOutline,
  type BookPageLines
} from "@chaturanga/shared/books/llm-output";
import {
  BOOK_STAGES,
  type BookChapterReport,
  type BookStage,
  type BookStatus
} from "@chaturanga/shared/types/books";
import { isOneOf } from "@chaturanga/shared/types/guards";
import type { RepertoireColor } from "@chaturanga/shared/types/repertoire";
import { queriesOn } from "../db/rows";
import { parseStoredJson } from "../stored-json";

export type BookRecord = {
  id: string;
  title: string;
  /** The user chose the title: reading the book's pages keeps it. */
  titleChosen: boolean;
  author: string | null;
  color: RepertoireColor | null;
  pageCount: number;
  printedPageOffset: number | null;
  sourceName: string;
  metadataTitle: string | null;
  sha256: string;
  status: BookStatus;
  stage: BookStage | null;
  ocrModel: string;
  structureModel: string;
  outline: BookOutline | null;
  repertoireId: string | null;
  costUsd: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
};

export type BookPageRecord = {
  pageIndex: number;
  printedPage: number | null;
  imageFile: string;
  /** Null until read. */
  ocrText: string | null;
  linesStatus: "pending" | "done" | "failed";
  lines: BookPageLines | null;
};

export type BookChapterRecord = {
  index: number;
  title: string;
  firstPageIndex: number;
  lastPageIndex: number;
  repertoireChapterId: string | null;
  report: BookChapterReport | null;
};

type BookRow = {
  id: string;
  title: string;
  title_chosen: number;
  author: string | null;
  color: string | null;
  page_count: number;
  printed_page_offset: number | null;
  source_name: string;
  metadata_title: string | null;
  sha256: string;
  status: BookStatus;
  stage: string | null;
  ocr_model: string;
  structure_model: string;
  outline_json: string | null;
  repertoire_id: string | null;
  cost_usd: number;
  error: string | null;
  created_at: number;
  updated_at: number;
};

type PageRow = {
  page_index: number;
  printed_page: number | null;
  image_file: string;
  ocr_text: string | null;
  ocr_status: "pending" | "done";
  lines_json: string | null;
  lines_status: "pending" | "done" | "failed";
};

type ChapterRow = {
  idx: number;
  title: string;
  first_page: number;
  last_page: number;
  repertoire_chapter_id: string | null;
  report_json: string | null;
};

/** Stored JSON read with its validator; null when it no longer reads (it is asked for again). */
function readJson<T>(text: string | null, parse: (value: unknown) => T): T | null {
  if (text === null) return null;
  try {
    return parse(JSON.parse(text));
  } catch {
    return null;
  }
}

function toBook(row: BookRow): BookRecord {
  return {
    id: row.id,
    title: row.title,
    titleChosen: row.title_chosen === 1,
    author: row.author,
    color: row.color === "white" || row.color === "black" ? row.color : null,
    pageCount: row.page_count,
    printedPageOffset: row.printed_page_offset,
    sourceName: row.source_name,
    metadataTitle: row.metadata_title,
    sha256: row.sha256,
    status: row.status,
    stage: isOneOf(BOOK_STAGES, row.stage) ? row.stage : null,
    ocrModel: row.ocr_model,
    structureModel: row.structure_model,
    outline: readJson(row.outline_json, parseBookOutline),
    repertoireId: row.repertoire_id,
    costUsd: row.cost_usd,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toPage(row: PageRow): BookPageRecord {
  const lines = readJson(row.lines_json, parsePageLines);
  return {
    pageIndex: row.page_index,
    printedPage: row.printed_page,
    imageFile: row.image_file,
    ocrText: row.ocr_status === "done" ? (row.ocr_text ?? "") : null,
    // Lines that no longer read are read again.
    linesStatus: row.lines_status === "pending" || lines ? row.lines_status : "pending",
    lines
  };
}

function toChapter(row: ChapterRow): BookChapterRecord {
  let report: BookChapterReport | null = null;
  try {
    report = row.report_json ? parseStoredJson<BookChapterReport>(row.report_json) : null;
  } catch {
    report = null;
  }
  return {
    index: row.idx,
    title: row.title,
    firstPageIndex: row.first_page,
    lastPageIndex: row.last_page,
    repertoireChapterId: row.repertoire_chapter_id,
    report
  };
}

/** What `update` may change on a book. */
export type BookPatch = Partial<
  Pick<
    BookRecord,
    | "title"
    | "titleChosen"
    | "author"
    | "color"
    | "printedPageOffset"
    | "status"
    | "stage"
    | "outline"
    | "repertoireId"
    | "costUsd"
    | "error"
    | "ocrModel"
    | "structureModel"
  >
>;

/** The columns a patch sets, with their values (fields left undefined aren't touched). */
function patchColumns(patch: BookPatch): [string, SQLInputValue][] {
  const outline =
    patch.outline === undefined ? undefined : patch.outline && JSON.stringify(patch.outline);
  const columns: [string, SQLInputValue | undefined][] = [
    ["title", patch.title],
    ["title_chosen", patch.titleChosen === undefined ? undefined : Number(patch.titleChosen)],
    ["author", patch.author],
    ["color", patch.color],
    ["printed_page_offset", patch.printedPageOffset],
    ["status", patch.status],
    ["stage", patch.stage],
    ["outline_json", outline],
    ["repertoire_id", patch.repertoireId],
    ["cost_usd", patch.costUsd],
    ["error", patch.error],
    ["ocr_model", patch.ocrModel],
    ["structure_model", patch.structureModel]
  ];
  return columns.filter((entry): entry is [string, SQLInputValue] => entry[1] !== undefined);
}

export type BookStore = ReturnType<typeof createBookStore>;

/** The book rows on the connection `db` returns (the app's, or a test's). */
export function createBookStore(db: () => DatabaseSync) {
  const sql = queriesOn(db);
  return {
    insert(book: Omit<BookRecord, "outline" | "repertoireId" | "costUsd" | "error" | "stage">) {
      sql.run(
        `INSERT INTO books (id, title, title_chosen, author, color, page_count, printed_page_offset,
          source_name, metadata_title, sha256, status, ocr_model, structure_model, created_at,
          updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        book.id,
        book.title,
        Number(book.titleChosen),
        book.author,
        book.color,
        book.pageCount,
        book.printedPageOffset,
        book.sourceName,
        book.metadataTitle,
        book.sha256,
        book.status,
        book.ocrModel,
        book.structureModel,
        book.createdAt,
        book.updatedAt
      );
    },

    get(id: string): BookRecord | null {
      const row = sql.get<BookRow>("SELECT * FROM books WHERE id = ?", id);
      return row ? toBook(row) : null;
    },

    list(): BookRecord[] {
      return sql.all<BookRow>("SELECT * FROM books ORDER BY created_at DESC").map(toBook);
    },

    /** The newest book imported from the same file that isn't finished, if any. */
    unfinishedBySha256(sha256: string): BookRecord | null {
      const row = sql.get<BookRow>(
        "SELECT * FROM books WHERE sha256 = ? AND status != 'done' ORDER BY created_at DESC LIMIT 1",
        sha256
      );
      return row ? toBook(row) : null;
    },

    forRepertoire(repertoireId: string): BookRecord | null {
      const row = sql.get<BookRow>(
        "SELECT * FROM books WHERE repertoire_id = ? ORDER BY created_at DESC LIMIT 1",
        repertoireId
      );
      return row ? toBook(row) : null;
    },

    update(id: string, patch: BookPatch, now: number): void {
      const columns = patchColumns(patch);
      const assignments = [...columns.map(([column]) => `${column} = ?`), "updated_at = ?"];
      sql.run(
        `UPDATE books SET ${assignments.join(", ")} WHERE id = ?`,
        ...columns.map(([, value]) => value),
        now,
        id
      );
    },

    remove(id: string): void {
      sql.run("DELETE FROM books WHERE id = ?", id);
    },

    /** Every book's id (for sweeping page folders no book owns). */
    ids(): Set<string> {
      return new Set(sql.all<{ id: string }>("SELECT id FROM books").map((row) => row.id));
    },

    /** A page's image, stored again: what was read of an earlier image is forgotten. */
    putPage(bookId: string, pageIndex: number, imageFile: string): void {
      sql.run(
        `INSERT INTO book_pages (book_id, page_index, image_file) VALUES (?, ?, ?)
        ON CONFLICT (book_id, page_index) DO UPDATE SET image_file = excluded.image_file,
          printed_page = NULL, ocr_text = NULL, ocr_status = 'pending', lines_json = NULL,
          lines_status = 'pending'`,
        bookId,
        pageIndex,
        imageFile
      );
    },

    /** The 0-based pages stored so far, in order. */
    pageIndexes(bookId: string): number[] {
      return sql
        .all<{ page_index: number }>(
          "SELECT page_index FROM book_pages WHERE book_id = ? ORDER BY page_index",
          bookId
        )
        .map((row) => row.page_index);
    },

    pageCount(bookId: string): number {
      return (
        sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM book_pages WHERE book_id = ?", bookId)
          ?.n ?? 0
      );
    },

    pages(bookId: string): BookPageRecord[] {
      return sql
        .all<PageRow>(
          `SELECT page_index, printed_page, image_file, ocr_text, ocr_status, lines_json, lines_status
          FROM book_pages WHERE book_id = ? ORDER BY page_index`,
          bookId
        )
        .map(toPage);
    },

    saveOcr(bookId: string, pageIndex: number, text: string, printedPage: number | null): void {
      sql.run(
        `UPDATE book_pages SET ocr_text = ?, printed_page = ?, ocr_status = 'done'
        WHERE book_id = ? AND page_index = ?`,
        text,
        printedPage,
        bookId,
        pageIndex
      );
    },

    saveLines(
      bookId: string,
      pageIndex: number,
      result: { lines: BookPageLines; status: "done" | "failed" }
    ): void {
      sql.run(
        "UPDATE book_pages SET lines_json = ?, lines_status = ? WHERE book_id = ? AND page_index = ?",
        JSON.stringify(result.lines),
        result.status,
        bookId,
        pageIndex
      );
    },

    /** Replaces the book's chapters (when its outline is read). */
    setChapters(
      bookId: string,
      chapters: readonly { title: string; firstPageIndex: number; lastPageIndex: number }[]
    ): void {
      sql.run("DELETE FROM book_chapters WHERE book_id = ?", bookId);
      chapters.forEach((chapter, index) =>
        sql.run(
          `INSERT INTO book_chapters (book_id, idx, title, first_page, last_page)
          VALUES (?, ?, ?, ?, ?)`,
          bookId,
          index,
          chapter.title,
          chapter.firstPageIndex,
          chapter.lastPageIndex
        )
      );
    },

    chapters(bookId: string): BookChapterRecord[] {
      return sql
        .all<ChapterRow>(
          `SELECT idx, title, first_page, last_page, repertoire_chapter_id, report_json
          FROM book_chapters WHERE book_id = ? ORDER BY idx`,
          bookId
        )
        .map(toChapter);
    },

    saveChapterResult(
      bookId: string,
      index: number,
      result: { repertoireChapterId: string | null; report: BookChapterReport }
    ): void {
      sql.run(
        `UPDATE book_chapters SET repertoire_chapter_id = ?, report_json = ?
        WHERE book_id = ? AND idx = ?`,
        result.repertoireChapterId,
        JSON.stringify(result.report),
        bookId,
        index
      );
    }
  };
}
