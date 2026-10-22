/**
 * One book import, from stored page images to a repertoire (see types/books.ts):
 *
 * 1. ocr — each page image is read by the vision model (four at a time, retried with backoff);
 * 2. outline — the first pages' text gives the title, author, side and chapters;
 * 3. lines — each chapter's pages, in order (a page's prompt carries where the book is), four
 *    chapters at a time;
 * 4. repair — lines with an illegal move are fixed from the page image (two tries each), by root
 *    error: one line of the lines failing on the same move in the same position is repaired and
 *    its correction carried over to the others (repair-groups.ts);
 * 5. write — the merged chapters become a repertoire.
 *
 * Everything read is stored as it arrives, so a cancelled, failed or interrupted import resumes
 * without paying for a page twice. Cancelling aborts the requests under way.
 */
import { bookChapterRanges, printedPageOf } from "@chaturanga/shared/books/chapters";
import {
  BookOutputError,
  extractJsonObject,
  parseBookOutline,
  parseBookRepair,
  parsePageLines,
  type BookLine,
  type BookOutline,
  type BookPageLines
} from "@chaturanga/shared/books/llm-output";
import {
  legalSans,
  mergeBookChapter,
  type BookLineFailure,
  type BookMergeResult
} from "@chaturanga/shared/books/merge";
import {
  applyBookRepairEdits,
  bookLineId,
  bookRepairEdits,
  groupBookFailures,
  type BookRepairEdit,
  type BookRepairGroup
} from "@chaturanga/shared/books/repair-groups";
import {
  bookLinesMessages,
  bookOcrMessages,
  bookOutlineMessages,
  bookRepairMessages,
  PREVIOUS_PAGE_TAIL,
  type BookContext,
  type BookLinesContext
} from "@chaturanga/shared/books/prompts";
import type { BookProgressEvent, BookStage, BookStatus } from "@chaturanga/shared/types/books";
import type { BookRepertoireInput } from "./book-repertoire";
import type { BookChapterRecord, BookPageRecord, BookRecord, BookStore } from "./book-store";
import { BookChatError, type BookChat, type BookChatRequest } from "./openrouter-chat";
import type { BookPageFiles } from "./page-files";

/** A stop with a message to show (the book is marked failed with it). */
export class BookImportError extends Error {}

export type BookJobDeps = {
  store: BookStore;
  files: Pick<BookPageFiles, "read">;
  chat: BookChat;
  writeRepertoire: (input: BookRepertoireInput) => Promise<unknown>;
  progress: (event: BookProgressEvent) => void;
  now?: () => number;
  /** Waits before a retry (tests resolve at once). */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  concurrency?: { ocr?: number; chapters?: number; repair?: number };
};

const OUTLINE_PAGES = 15;
const RETRY_DELAYS_MS = [2_000, 8_000];
const MAX_REPAIRS = 2;
const MAX_TOKENS = { ocr: 6_000, outline: 8_000, lines: 24_000, repair: 16_000 };

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

/**
 * Runs `task` on every item, `limit` at a time. After a failure nothing new starts; the first
 * failure is thrown once the running ones have settled.
 */
async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  const state: { cursor: number; failure: { error: unknown } | null } = {
    cursor: 0,
    failure: null
  };
  async function worker() {
    while (!state.failure && state.cursor < items.length) {
      const item = items[state.cursor++];
      try {
        await task(item);
      } catch (error) {
        state.failure ??= { error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (state.failure) throw state.failure.error;
}

function dataUrl(image: { bytes: Buffer; type: string }): string {
  return `data:${image.type};base64,${image.bytes.toString("base64")}`;
}

type ChapterMerge = { chapter: BookChapterRecord; result: BookMergeResult };

/**
 * One chapter's repair progress: the root errors seen failing (`total`), those no longer failing
 * (`done`), and the lines they cover. Repairs can uncover errors further down a line, so the
 * totals may grow.
 */
class RepairTally {
  private readonly errors = new Set<string>();
  private readonly failingLines = new Set<string>();
  private open = 0;

  see(failures: readonly BookLineFailure[]): void {
    const groups = groupBookFailures(failures);
    for (const group of groups) this.errors.add(group.key);
    for (const failure of failures) this.failingLines.add(bookLineId(failure));
    this.open = groups.length;
  }

  get total(): number {
    return this.errors.size;
  }

  get done(): number {
    return this.errors.size - this.open;
  }

  get lines(): number {
    return this.failingLines.size;
  }
}

class BookRun {
  private book: BookRecord;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private stage: BookStage | null = null;

  constructor(
    book: BookRecord,
    private readonly deps: BookJobDeps,
    private readonly signal: AbortSignal
  ) {
    this.book = book;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? abortableSleep;
  }

  get id(): string {
    return this.book.id;
  }

  /** Stores the book's status (and stage), and tells the renderer. */
  setStatus(status: BookStatus, error: string | null = null): void {
    this.deps.store.update(this.id, { status, error, stage: this.stage }, this.now());
    this.book = { ...this.book, status, error };
    this.emit(0, 0);
  }

  private enter(stage: BookStage): void {
    this.stage = stage;
    this.deps.store.update(this.id, { stage }, this.now());
  }

  private emit(
    done: number,
    total: number,
    chapter: BookChapterRecord | null = null,
    lines: number | null = null
  ): void {
    this.deps.progress({
      bookId: this.id,
      status: this.book.status,
      stage: this.stage,
      done,
      total,
      lines,
      costUsd: this.book.costUsd,
      chapter: chapter && { index: chapter.index, title: chapter.title },
      error: this.book.error
    });
  }

  /** One request, retried with backoff while the failure may pass; its charge is added. */
  private async ask(request: Omit<BookChatRequest, "signal">): Promise<string> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const answer = await this.deps.chat({ ...request, signal: this.signal });
        this.book.costUsd += answer.costUsd;
        this.deps.store.update(this.id, { costUsd: this.book.costUsd }, this.now());
        return answer.text;
      } catch (error) {
        const retry = error instanceof BookChatError && error.retryable;
        if (!retry || attempt >= RETRY_DELAYS_MS.length) throw error;
        await this.sleep(RETRY_DELAYS_MS[attempt], this.signal);
      }
    }
  }

  /** A JSON answer read with `parse`; asked a second time when the first doesn't read. */
  private async askJson<T>(
    request: Omit<BookChatRequest, "signal" | "json" | "reasoning">,
    parse: (value: unknown) => T
  ): Promise<T> {
    const json = { ...request, json: true, reasoning: "low" as const };
    try {
      return parse(extractJsonObject(await this.ask(json)));
    } catch (error) {
      if (!(error instanceof BookOutputError)) throw error;
      return parse(extractJsonObject(await this.ask(json)));
    }
  }

  private async image(page: BookPageRecord): Promise<string> {
    const image = await this.deps.files.read(this.id, page.imageFile);
    if (!image) {
      throw new BookImportError(
        `The image of page ${page.pageIndex + 1} is missing. Import the PDF again.`
      );
    }
    return dataUrl(image);
  }

  async ocr(): Promise<void> {
    this.enter("ocr");
    const pending = this.deps.store.pages(this.id).filter((page) => page.ocrText === null);
    const total = this.book.pageCount;
    let done = total - pending.length;
    this.emit(done, total);
    await eachLimited(pending, this.deps.concurrency?.ocr ?? 4, async (page) => {
      const text = await this.ask({
        model: this.book.ocrModel,
        messages: bookOcrMessages(await this.image(page)),
        maxTokens: MAX_TOKENS.ocr
      });
      this.deps.store.saveOcr(this.id, page.pageIndex, text, printedPageOf(text));
      done += 1;
      this.emit(done, total);
    });
  }

  async outline(): Promise<BookOutline> {
    this.enter("outline");
    if (this.book.outline) return this.book.outline;
    this.emit(0, 1);
    const pages = this.deps.store.pages(this.id);
    const outline = await this.askJson(
      {
        model: this.book.structureModel,
        messages: bookOutlineMessages({
          metadataTitle: this.book.metadataTitle,
          pages: pages
            .slice(0, OUTLINE_PAGES)
            .map((page) => ({ pdfPage: page.pageIndex + 1, text: page.ocrText ?? "" }))
        }),
        maxTokens: MAX_TOKENS.outline
      },
      parseBookOutline
    );
    const ranges = bookChapterRanges(outline, pages, this.book.pageCount);
    this.deps.store.setChapters(this.id, ranges);
    const patch = {
      // A title the user chose stays.
      title: this.book.titleChosen ? this.book.title : outline.title,
      author: outline.author,
      color: outline.color,
      printedPageOffset: outline.printedPageOffset,
      outline
    };
    this.deps.store.update(this.id, patch, this.now());
    this.book = { ...this.book, ...patch };
    this.emit(1, 1);
    return outline;
  }

  private get context(): BookContext {
    return { title: this.book.title, author: this.book.author, color: this.book.color ?? "white" };
  }

  async lines(pages: Map<number, BookPageRecord>): Promise<void> {
    this.enter("lines");
    const chapters = this.deps.store.chapters(this.id);
    const inChapters = chapters.flatMap((chapter) => pagesOf(chapter, pages));
    const total = inChapters.length;
    let done = inChapters.filter((page) => page.linesStatus !== "pending").length;
    this.emit(done, total);
    await eachLimited(chapters, this.deps.concurrency?.chapters ?? 4, async (chapter) => {
      const where: BookLinesContext = { game: null, mainLine: null };
      let previous: BookPageRecord | null = null;
      for (const page of pagesOf(chapter, pages)) {
        if (page.linesStatus === "pending") {
          await this.readLines(page, previous, where);
          done += 1;
          this.emit(done, total, chapter);
        }
        if (page.lines?.game) where.game = page.lines.game;
        const main = page.lines?.lines.filter((line) => line.kind === "main").at(-1);
        if (main) where.mainLine = main.moves;
        previous = page;
      }
    });
  }

  private async readLines(
    page: BookPageRecord,
    previous: BookPageRecord | null,
    where: BookLinesContext
  ): Promise<void> {
    let lines: BookPageLines;
    let status: "done" | "failed" = "done";
    try {
      lines = await this.askJson(
        {
          model: this.book.structureModel,
          messages: bookLinesMessages({
            book: this.context,
            context: where,
            previousPage: previous?.ocrText?.slice(-PREVIOUS_PAGE_TAIL) ?? null,
            page: page.ocrText ?? ""
          }),
          maxTokens: MAX_TOKENS.lines
        },
        parsePageLines
      );
    } catch (error) {
      if (!(error instanceof BookOutputError)) throw error;
      // Twice unreadable: the page counts as read without lines (the chapter's report says so).
      lines = { game: null, lines: [] };
      status = "failed";
    }
    this.deps.store.saveLines(this.id, page.pageIndex, { lines, status });
    page.lines = lines;
    page.linesStatus = status;
  }

  private merge(chapter: BookChapterRecord, pages: Map<number, BookPageRecord>): BookMergeResult {
    return mergeBookChapter({
      color: this.book.color ?? "white",
      pages: pagesOf(chapter, pages).map((page) => ({
        pageIndex: page.pageIndex,
        printedPage: page.printedPage,
        lines: page.lines ?? { game: null, lines: [] },
        ocrText: page.ocrText,
        unreadable: page.linesStatus === "failed"
      }))
    });
  }

  /** The chapter's failing lines that may still be repaired. */
  private openFailures(
    chapter: BookChapterRecord,
    pages: Map<number, BookPageRecord>
  ): BookLineFailure[] {
    return this.merge(chapter, pages).failures.filter(
      (failure) => failure.repairAttempts < MAX_REPAIRS
    );
  }

  /**
   * Repairs each chapter's failing lines by root error (repair-groups.ts), four chapters at a
   * time: the shallowest error first, one line of it repaired by the model and its correction
   * carried over to every failing line that copied it; a line the correction doesn't fix is
   * grouped again on the next round (and repaired itself when it leads its group).
   */
  async repair(pages: Map<number, BookPageRecord>): Promise<ChapterMerge[]> {
    this.enter("repair");
    const chapters = this.deps.store.chapters(this.id);
    const tallies = chapters.map(() => new RepairTally());
    const report = () => {
      const [done, total, lines] = tallies.reduce(
        (sum, tally) => [sum[0] + tally.done, sum[1] + tally.total, sum[2] + tally.lines],
        [0, 0, 0]
      );
      this.emit(done, total, null, lines);
    };
    chapters.forEach((chapter, index) => tallies[index].see(this.openFailures(chapter, pages)));
    report();
    const work = chapters.map((chapter, index) => ({ chapter, tally: tallies[index] }));
    await eachLimited(work, this.deps.concurrency?.repair ?? 4, async ({ chapter, tally }) => {
      for (;;) {
        const failures = this.openFailures(chapter, pages);
        tally.see(failures);
        report();
        const group = groupBookFailures(failures).at(0);
        if (!group) return;
        await this.repairGroup(group, failures, pages);
      }
    });
    return chapters.map((chapter) => ({ chapter, result: this.merge(chapter, pages) }));
  }

  /**
   * One root error: its representative is repaired (up to two tries, each checked by playing the
   * line again), then its correction is carried over to the chapter's other failing lines that
   * reach it. Every line rewritten counts the repair and keeps its movetext from before.
   */
  private async repairGroup(
    group: BookRepairGroup,
    failures: readonly BookLineFailure[],
    pages: Map<number, BookPageRecord>
  ): Promise<void> {
    const first = group.representative;
    const page = pages.get(first.pageIndex);
    const line = page?.lines?.lines[first.lineIndex];
    if (!page || !line) throw new BookImportError("A line to repair is missing. Try again.");
    const images = [await this.image(page)];
    const before = pages.get(first.pageIndex - 1);
    if (before) images.push(await this.image(before));
    const original = line.moves;
    let failure: BookLineFailure | undefined = first;
    while (failure && (line.repairAttempts ?? 0) < MAX_REPAIRS) {
      failure = await this.repairOnce({ failure, page, line, images });
    }
    const edits = bookRepairEdits(original, line.moves, first.ply);
    if (edits) this.carryOver(edits, first, failures, pages);
  }

  /** Applies a representative's corrections to the other failing lines (stored as rewritten). */
  private carryOver(
    edits: readonly BookRepairEdit[],
    representative: BookLineFailure,
    failures: readonly BookLineFailure[],
    pages: Map<number, BookPageRecord>
  ): void {
    const rewritten = new Set<number>();
    for (const other of failures) {
      if (bookLineId(other) === bookLineId(representative)) continue;
      const target = pages.get(other.pageIndex)?.lines?.lines[other.lineIndex];
      const moves = target && applyBookRepairEdits(target.moves, edits);
      if (!target || !moves) continue;
      target.repairedFrom ??= target.moves;
      target.moves = moves;
      target.repairAttempts = (target.repairAttempts ?? 0) + 1;
      rewritten.add(other.pageIndex);
    }
    for (const pageIndex of rewritten) {
      const lines = pages.get(pageIndex)?.lines;
      if (lines) this.deps.store.saveLines(this.id, pageIndex, { lines, status: "done" });
    }
  }

  /** One repair; resolves with the line's failure after it (none: legal, or given up on). */
  private async repairOnce(input: {
    failure: BookLineFailure;
    page: BookPageRecord;
    line: BookLine;
    images: string[];
  }): Promise<BookLineFailure | undefined> {
    const { failure, page, line } = input;
    const answer = await this.askJson(
      {
        model: this.book.structureModel,
        messages: bookRepairMessages({
          ...failure,
          legalSans: legalSans(failure.fenBefore),
          images: input.images
        }),
        maxTokens: MAX_TOKENS.repair
      },
      parseBookRepair
    ).catch((error: unknown) => {
      if (error instanceof BookOutputError) return { moves: null };
      throw error;
    });
    line.repairAttempts = (line.repairAttempts ?? 0) + 1;
    if (answer.moves) {
      line.repairedFrom ??= line.moves;
      line.moves = answer.moves;
    }
    const lines = page.lines ?? { game: null, lines: [line] };
    this.deps.store.saveLines(this.id, page.pageIndex, { lines, status: "done" });
    if (!answer.moves) return undefined;
    const next = mergeBookChapter({
      color: this.book.color ?? "white",
      pages: [{ ...page, lines: { game: null, lines: [line] } }]
    }).failures.at(0);
    return next && { ...next, lineIndex: failure.lineIndex };
  }

  async write(merged: readonly ChapterMerge[]): Promise<void> {
    this.enter("write");
    if (this.book.repertoireId) return;
    const kept = merged.filter(({ result }) => result.tree.length > 1);
    if (!kept.length) throw new BookImportError("No moves could be read from this book.");
    this.emit(0, 1);
    const { title, author, color } = this.book;
    await this.deps.writeRepertoire({
      name: title,
      color: color ?? "white",
      description: `Imported from “${title}”${author ? ` by ${author}` : ""}.`,
      chapters: kept.map(({ chapter, result }) => ({
        title: chapter.title,
        headers: { Event: chapter.title, ...(author ? { Annotator: author } : {}) },
        tree: result.tree,
        nodeMeta: result.nodeMeta
      })),
      linkBook: (repertoireId, chapterIds) => {
        this.deps.store.update(this.id, { repertoireId }, this.now());
        for (const { chapter, result } of merged) {
          const position = kept.findIndex((entry) => entry.chapter.index === chapter.index);
          this.deps.store.saveChapterResult(this.id, chapter.index, {
            repertoireChapterId: position < 0 ? null : chapterIds[position],
            report: result.report
          });
        }
      },
      signal: this.signal
    });
    this.emit(1, 1);
  }

  /** The pages as stored now, by index (shared by the stages that change their lines). */
  pages(): Map<number, BookPageRecord> {
    return new Map(this.deps.store.pages(this.id).map((page) => [page.pageIndex, page]));
  }

  finish(): void {
    this.stage = null;
    this.setStatus("done");
  }
}

function pagesOf(chapter: BookChapterRecord, pages: Map<number, BookPageRecord>): BookPageRecord[] {
  const found: BookPageRecord[] = [];
  for (let index = chapter.firstPageIndex; index <= chapter.lastPageIndex; index += 1) {
    const page = pages.get(index);
    if (page) found.push(page);
  }
  return found;
}

/**
 * Runs (or resumes) the import of a stored book until it is done, cancelled through `signal`
 * (paused) or stopped by an error (failed, with a message to show). Resolves with the status it
 * ended in; never rejects.
 */
export async function runBookImport(
  bookId: string,
  deps: BookJobDeps,
  signal: AbortSignal
): Promise<BookStatus> {
  const book = deps.store.get(bookId);
  if (!book) return "failed";
  const run = new BookRun(book, deps, signal);
  run.setStatus("running");
  try {
    await run.ocr();
    await run.outline();
    const pages = run.pages();
    await run.lines(pages);
    await run.write(await run.repair(pages));
    run.finish();
    return "done";
  } catch (error) {
    if (signal.aborted) {
      run.setStatus("paused");
      return "paused";
    }
    run.setStatus("failed", failureMessage(error));
    return "failed";
  }
}

function failureMessage(error: unknown): string {
  if (error instanceof BookChatError || error instanceof BookImportError) return error.message;
  if (error instanceof BookOutputError) {
    return "The model's answers couldn't be read. Try again, or pick another model.";
  }
  return `The import stopped: ${error instanceof Error ? error.message : String(error)}`;
}
