/**
 * The book import's pure parts in the renderer: what a book being imported shows on the hub (its
 * stage, progress, cost and actions), which books just finished, continuing an upload with the
 * same file, and in Study the book page of a move and how a page is labelled.
 */
import { bookPageOf } from "@chaturanga/shared/books/book-page";
import type { ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import type {
  BookChapterReport,
  BookPages,
  BookProgressEvent,
  BookStage,
  BookStatus,
  BookSummary
} from "@chaturanga/shared/types/books";

/* ------------------------------------------------------------------ hub */

/** The renderer's page upload of a book (rendering the PDF and sending each page). */
export type BookUpload = {
  /** `saving`: pages are being sent; `failed`: sending (or starting after it) stopped on `error`. */
  phase: "saving" | "failed";
  pagesAdded: number;
  pageCount: number;
  error: string | null;
};

export type BookAction = "cancel" | "start" | "resume" | "retry" | "continue" | "remove";

/** What a book's hub row shows. */
export type BookRowState = {
  status: BookStatus;
  /** "Reading pages", "Building chapter 2 of 9", "Repairing 3 errors (9 lines)", "Paused · Reading pages"… */
  label: string;
  /** Work done and to do in the stage; null when not known (no bar, or an indeterminate one). */
  progress: { done: number; total: number } | null;
  costUsd: number;
  error: string | null;
  actions: BookAction[];
};

const STAGE_LABELS: Record<BookStage, string> = {
  ocr: "Reading pages",
  outline: "Finding chapters",
  lines: "Building chapters",
  repair: "Repairing lines",
  write: "Creating repertoire"
};

const count = (n: number, noun: string) =>
  `${n.toLocaleString("en-US")} ${noun}${n === 1 ? "" : "s"}`;

/**
 * The stage's label: the chapter being read during `lines` ("Building chapter 2 of 9"); during
 * `repair`, the root errors and the lines they cover ("Repairing 140 errors (538 lines)").
 */
export function bookStageLabel(
  stage: BookStage | null,
  chapter: { index: number } | null = null,
  chapterCount = 0,
  repair: { errors: number; lines: number } | null = null
): string {
  if (stage === null) return "Starting";
  if (stage === "lines" && chapter && chapterCount > 0) {
    return `Building chapter ${Math.min(chapter.index + 1, chapterCount)} of ${chapterCount}`;
  }
  if (stage === "repair" && repair && repair.errors > 0) {
    return `Repairing ${count(repair.errors, "error")} (${count(repair.lines, "line")})`;
  }
  return STAGE_LABELS[stage];
}

type RowParts = Pick<BookRowState, "label" | "progress" | "actions">;

/** The row of a book past saving its pages, by status (`stage`: the stage's label). */
const ROWS: Record<
  Exclude<BookStatus, "adding-pages">,
  (stage: string, progress: BookRowState["progress"], saving: boolean) => RowParts
> = {
  // Between the last page saved and the start: no action yet.
  ready: (_stage, _progress, saving) => ({
    label: "Pages saved",
    progress: null,
    actions: saving ? [] : ["start", "remove"]
  }),
  running: (stage, progress) => ({ label: stage, progress, actions: ["cancel", "remove"] }),
  paused: (stage, progress) => ({
    label: `Paused · ${stage}`,
    progress,
    actions: ["resume", "remove"]
  }),
  failed: (stage) => ({
    label: `Stopped · ${stage}`,
    progress: null,
    actions: ["retry", "remove"]
  }),
  done: () => ({ label: "Done", progress: null, actions: [] })
};

/** The book as its latest progress event has it (as listed until one arrives). */
function currentState(book: BookSummary, event: BookProgressEvent | null) {
  if (event?.bookId !== book.id) {
    return {
      status: book.status,
      stage: book.stage,
      chapter: null,
      costUsd: book.costUsd,
      progress: null,
      repair: null,
      error: book.error
    };
  }
  return {
    status: event.status,
    stage: event.stage,
    chapter: event.chapter,
    costUsd: Math.max(book.costUsd, event.costUsd),
    progress: event.total > 0 ? { done: event.done, total: event.total } : null,
    repair: event.lines === null ? null : { errors: event.total, lines: event.lines },
    error: event.error ?? book.error
  };
}

/** A book whose pages are being saved (`upload`), or wait to be (Continue picks the file). */
function savingRow(
  book: BookSummary,
  upload: BookUpload | null,
  costUsd: number,
  failure: string | null
): BookRowState {
  const saving = upload?.phase === "saving";
  return {
    status: "adding-pages",
    label: "Saving pages",
    progress: { done: upload ? upload.pagesAdded : book.pagesAdded, total: book.pageCount },
    costUsd,
    error: saving ? null : failure,
    actions: saving ? ["cancel", "remove"] : ["continue", "remove"]
  };
}

/**
 * A book's row: the list's summary, updated by the latest progress event for it (newer, while
 * the import runs) and by the upload this window runs for it.
 */
export function bookRowState(
  book: BookSummary,
  event: BookProgressEvent | null,
  upload: BookUpload | null,
  /** Why the last action on it failed (Start without a usable key, say). */
  actionError: string | null = null
): BookRowState {
  const now = currentState(book, event);
  const failure = actionError ?? upload?.error ?? null;
  if (now.status === "adding-pages") return savingRow(book, upload, now.costUsd, failure);
  const stage = bookStageLabel(now.stage, now.chapter, book.chapters.length, now.repair);
  const stopped = now.status === "failed" ? (now.error ?? "The import stopped.") : null;
  return {
    status: now.status,
    ...ROWS[now.status](stage, now.progress, upload?.phase === "saving"),
    costUsd: now.costUsd,
    error: now.status === "done" ? null : (failure ?? stopped)
  };
}

/** The books an import row is shown for: every one not done yet. */
export function importingBooks(books: readonly BookSummary[]): BookSummary[] {
  return books.filter((book) => book.status !== "done");
}

/**
 * Books that finished since they were last seen (`known`: status by book id): each gets a
 * "… is ready" notice. Books seen for the first time finished long ago.
 */
export function newlyDone(
  known: ReadonlyMap<string, BookStatus>,
  books: readonly BookSummary[]
): BookSummary[] {
  return books.filter((book) => {
    const before = known.get(book.id);
    return book.status === "done" && before !== undefined && before !== "done";
  });
}

/** "$0.42" (cents; below a cent, "< $0.01"; nothing spent, "$0"). */
export function formatUsd(amount: number): string {
  if (amount <= 0) return "$0";
  if (amount < 0.01) return "< $0.01";
  return `$${amount.toFixed(2)}`;
}

/** "about 15 min", "about 2 h 10 min". */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `about ${hours} h ${rest} min` : `about ${hours} h`;
}

/**
 * Whether a PDF picked to continue a book's upload is the same file; the sentence to show when it
 * isn't, else null.
 */
export function sameBookFile(
  book: Pick<BookSummary, "sha256" | "pageCount" | "sourceName">,
  file: { sha256: string; pageCount: number }
): string | null {
  if (file.sha256 === book.sha256 && file.pageCount === book.pageCount) return null;
  return `This isn't the file this import started from. Pick “${book.sourceName}” again (the same file, unchanged).`;
}

/** The PDF's file name without its extension (the title until a better one is known). */
export function fileTitle(name: string): string {
  return name.replace(/\.pdf$/i, "").trim() || name;
}

/* ------------------------------------------------------------------ study */

/**
 * The book page (1-based PDF page) a move is on: its own `[%page N]`, else the nearest one on its
 * path from the root; else the first page of the book chapter it is in (`firstPage`), if any.
 */
export function bookPageAt(
  lookup: Pick<ChapterLookup, "nodesById">,
  nodeId: string,
  firstPage: number | null = null
): number | null {
  for (
    let node = lookup.nodesById.get(nodeId);
    node;
    node = node.parentId ? lookup.nodesById.get(node.parentId) : undefined
  ) {
    const page = bookPageOf(node.comment);
    if (page !== null) return page;
  }
  return firstPage;
}

/** The first page (1-based) of the book chapter that became repertoire chapter `chapterId`. */
export function chapterFirstPage(pages: BookPages, chapterId: string): number | null {
  const chapter = pages.chapters.find((entry) => entry.repertoireChapterId === chapterId);
  return chapter ? chapter.firstPageIndex + 1 : null;
}

/** "p. 41" (the number printed on the page, else the PDF's), and the PDF page as its title. */
export function bookPageLabel(
  pages: Pick<BookPages, "pages">,
  page: number
): { text: string; title: string } {
  const printed = pages.pages.find((entry) => entry.pageIndex === page - 1)?.printedPage ?? null;
  return { text: `p. ${printed ?? page}`, title: `PDF page ${page}` };
}

/**
 * The page the Book tab shows: one the user turned to (`view`, while its move stays selected),
 * else the selected move's page; kept within the book.
 */
export function shownBookPage(
  movePage: number | null,
  view: { nodeId: string; page: number } | null,
  selectedNodeId: string,
  pageCount: number
): number | null {
  const page = view && view.nodeId === selectedNodeId ? view.page : movePage;
  if (page === null || pageCount < 1) return null;
  return Math.min(Math.max(page, 1), pageCount);
}

/** One thing to check in a book chapter: a line still illegal after repair, or a page unread. */
export type BookChapterIssue = {
  /** 1-based PDF page. */
  page: number;
  /** Its printed number, when read. */
  printedPage: number | null;
  label: string | null;
  error: string;
};

/** "1,477 moves · 6 lines need a look", and its issues in page order. */
export function chapterReportSummary(report: BookChapterReport): {
  text: string;
  issues: BookChapterIssue[];
} {
  const issues: BookChapterIssue[] = [
    ...report.illegalLines.map((line) => ({
      page: line.pageIndex + 1,
      printedPage: line.printedPage,
      label: line.label,
      error: line.error
    })),
    ...(report.carriedLines ?? []).map((line) => ({
      page: line.pageIndex + 1,
      printedPage: line.printedPage,
      label: line.label,
      error: line.error
    })),
    ...report.unreadablePages.map((pageIndex) => ({
      page: pageIndex + 1,
      printedPage: null,
      label: null,
      error: "This page's lines couldn't be read."
    }))
  ].sort((a, b) => a.page - b.page);
  const moves = `${report.moves.toLocaleString("en-US")} ${report.moves === 1 ? "move" : "moves"}`;
  const lines = report.illegalLines.length;
  const carried = report.carriedLines?.length ?? 0;
  const unread = report.unreadablePages.length;
  const parts = [moves];
  if (lines) parts.push(`${lines} ${lines === 1 ? "line needs" : "lines need"} a look`);
  if (carried) parts.push(`${carried} corrected like another line`);
  if (unread) parts.push(`${unread} ${unread === 1 ? "page" : "pages"} unread`);
  if (!lines && !carried && !unread) parts.push("every line read");
  return { text: parts.join(" · "), issues };
}
