/**
 * The book import's API (what IPC calls, through books/index.ts): estimate, create a book and add
 * its rendered pages, start / resume / cancel its import, read its status and a repertoire's book
 * pages. One import runs per book; several books may run at once.
 */
import { nanoid } from "nanoid";
import { estimateBookImport, type ModelPrice } from "@chaturanga/shared/books/estimate";
import type {
  AddBookPageInput,
  BookEstimate,
  BookEstimateInput,
  BookPages,
  BookProgressEvent,
  BookSummary,
  CreateBookInput
} from "@chaturanga/shared/types/books";
import type { BookRepertoireInput } from "./book-repertoire";
import type { BookRecord, BookStore } from "./book-store";
import { BookImportError, runBookImport, type BookJobDeps } from "./import-job";
import type { BookChat } from "./openrouter-chat";
import type { BookPageFiles } from "./page-files";

export type BookServiceDeps = {
  store: BookStore;
  files: BookPageFiles;
  /** The chat on the user's key; rejects with a message to show when there is no usable key. */
  chat: () => Promise<BookChat>;
  /** The models chosen in Settings (page reader, and the model turning text into lines). */
  models: () => Promise<{ ocr: string; structure: string }>;
  prices: {
    pricesFor(
      models: readonly string[]
    ): Promise<{ prices: ModelPrice[]; source: "live" | "fallback" }>;
  };
  writeRepertoire: (input: BookRepertoireInput) => Promise<unknown>;
  progress: (event: BookProgressEvent) => void;
  /** Lets the renderer load the page images of a book folder (image-access.ts). */
  allowFolder: (dir: string) => void;
  /** The renderer's URL for a page image file. */
  imageSrc: (path: string) => string;
  /** Hears about an import that ended in an error it couldn't even record. */
  log: (message: string, error: unknown) => void;
  now?: () => number;
  job?: Pick<BookJobDeps, "sleep" | "concurrency">;
};

export type BookService = ReturnType<typeof createBookService>;

const RESUMABLE: ReadonlySet<string> = new Set(["ready", "paused", "failed"]);

export function createBookService(deps: BookServiceDeps) {
  const now = deps.now ?? Date.now;
  const running = new Map<string, { controller: AbortController; finished: Promise<unknown> }>();

  /** The pages not stored yet (0-based). */
  function missingPages(book: BookRecord): number[] {
    const stored = new Set(deps.store.pageIndexes(book.id));
    return Array.from({ length: book.pageCount }, (_, index) => index).filter(
      (index) => !stored.has(index)
    );
  }

  function summary(book: BookRecord): BookSummary {
    const missing = missingPages(book);
    return {
      id: book.id,
      title: book.title,
      author: book.author,
      color: book.color,
      sourceName: book.sourceName,
      sha256: book.sha256,
      pageCount: book.pageCount,
      pagesAdded: book.pageCount - missing.length,
      missingPageIndexes: missing,
      status: book.status,
      stage: book.stage,
      error: book.error,
      costUsd: book.costUsd,
      repertoireId: book.repertoireId,
      ocrModel: book.ocrModel,
      structureModel: book.structureModel,
      chapters: deps.store.chapters(book.id),
      createdAt: book.createdAt,
      updatedAt: book.updatedAt
    };
  }

  function requireBook(bookId: string): BookRecord {
    const book = deps.store.get(bookId);
    if (!book) throw new BookImportError("This book was deleted.");
    return book;
  }

  async function launch(bookId: string): Promise<BookSummary> {
    const book = requireBook(bookId);
    if (running.has(bookId)) return summary(book);
    if (!RESUMABLE.has(book.status))
      throw new BookImportError("This book's import can't start now.");
    if (deps.store.pageCount(bookId) < book.pageCount) {
      throw new BookImportError("Some of the book's pages are missing. Import the PDF again.");
    }
    const [chat, models] = await Promise.all([deps.chat(), deps.models()]);
    // Asked twice at once: the first one runs it.
    if (running.has(bookId)) return summary(requireBook(bookId));
    // The models chosen now (a resumed import follows a model fixed in Settings).
    deps.store.update(bookId, { ocrModel: models.ocr, structureModel: models.structure }, now());
    const controller = new AbortController();
    const finished = runBookImport(
      bookId,
      {
        store: deps.store,
        files: deps.files,
        chat,
        writeRepertoire: deps.writeRepertoire,
        progress: deps.progress,
        now,
        ...deps.job
      },
      controller.signal
    )
      .catch((error: unknown) => deps.log(`book ${bookId}: the import ended badly`, error))
      .finally(() => running.delete(bookId));
    running.set(bookId, { controller, finished });
    return summary(requireBook(bookId));
  }

  return {
    /** Imports that were running when the app last closed can be resumed. */
    recoverInterrupted(): void {
      for (const book of deps.store.list()) {
        if (book.status === "running" && !running.has(book.id)) {
          deps.store.update(book.id, { status: "paused" }, now());
        }
      }
    },

    async estimate(input: BookEstimateInput): Promise<BookEstimate> {
      const models = await deps.models();
      const { prices, source } = await deps.prices.pricesFor([models.ocr, models.structure]);
      return {
        pageCount: input.pageCount,
        ocrModel: models.ocr,
        structureModel: models.structure,
        ...estimateBookImport({
          pageCount: input.pageCount,
          ocrPrice: prices[0],
          structurePrice: prices[1]
        }),
        prices: source
      };
    },

    /**
     * A new book waiting for its pages, or the unfinished import of the same file (same contents
     * and page count), which then continues where it stopped. A title the user chose is kept
     * (the one read from the pages never replaces it), on a continued import too.
     */
    async create(input: CreateBookInput): Promise<BookSummary> {
      const title = input.title ?? null;
      const existing = deps.store.unfinishedBySha256(input.sha256);
      if (existing && existing.pageCount === input.pageCount) {
        if (title !== null && (title !== existing.title || !existing.titleChosen)) {
          deps.store.update(existing.id, { title, titleChosen: true }, now());
        }
        return summary(requireBook(existing.id));
      }
      const models = await deps.models();
      const at = now();
      const id = nanoid();
      deps.store.insert({
        id,
        title: title ?? input.metadataTitle ?? input.sourceName.replace(/\.pdf$/i, ""),
        titleChosen: title !== null,
        author: null,
        color: null,
        pageCount: input.pageCount,
        printedPageOffset: null,
        sourceName: input.sourceName,
        metadataTitle: input.metadataTitle,
        sha256: input.sha256,
        status: "adding-pages",
        ocrModel: models.ocr,
        structureModel: models.structure,
        createdAt: at,
        updatedAt: at
      });
      return summary(requireBook(id));
    },

    /** Stores one rendered page; the book is `ready` once it has them all. */
    async addPage(input: AddBookPageInput): Promise<BookSummary> {
      const book = requireBook(input.bookId);
      if (running.has(book.id) || book.status === "done") {
        throw new BookImportError("This book's pages can't change now.");
      }
      if (input.pageIndex >= book.pageCount)
        throw new BookImportError("The book has no such page.");
      const path = await deps.files.save(book.id, input.pageIndex, input.bytes);
      deps.store.putPage(book.id, input.pageIndex, path);
      if (book.status === "adding-pages" && deps.store.pageCount(book.id) === book.pageCount) {
        deps.store.update(book.id, { status: "ready" }, now());
      }
      return summary(requireBook(book.id));
    },

    start: launch,
    resume: launch,

    /** Stops a running import (it pauses; what was read is kept). Resolves once it stopped. */
    async cancel(bookId: string): Promise<BookSummary> {
      const run = running.get(bookId);
      run?.controller.abort();
      await run?.finished;
      return summary(requireBook(bookId));
    },

    get(bookId: string): BookSummary | null {
      const book = deps.store.get(bookId);
      return book && summary(book);
    },

    list(): BookSummary[] {
      return deps.store.list().map(summary);
    },

    /**
     * The book pages of a repertoire imported from a book (null for any other repertoire). A page
     * whose image file is gone has no `src` (the Book tab says so).
     */
    async pages(repertoireId: string): Promise<BookPages | null> {
      const book = deps.store.forRepertoire(repertoireId);
      if (!book) return null;
      deps.allowFolder(deps.files.folderOf(book.id));
      const pages = await Promise.all(
        deps.store.pages(book.id).map(async (page) => ({
          pageIndex: page.pageIndex,
          printedPage: page.printedPage,
          src: (await deps.files.readable(book.id, page.imageFile))
            ? deps.imageSrc(page.imageFile)
            : null,
          ocrText: page.ocrText
        }))
      );
      return { bookId: book.id, title: book.title, pages, chapters: deps.store.chapters(book.id) };
    },

    /** Deletes a book (not its repertoire) and its page images; a running import stops first. */
    async remove(bookId: string): Promise<void> {
      const run = running.get(bookId);
      run?.controller.abort();
      await run?.finished;
      deps.store.remove(bookId);
      await deps.files.remove(bookId);
    },

    /** Deletes page folders whose book is gone (it went with its repertoire). */
    sweep(): Promise<number> {
      return deps.files.sweep(deps.store.ids());
    }
  };
}
