import { describe, expect, it } from "vitest";
import type {
  BookChapterReport,
  BookPages,
  BookProgressEvent,
  BookStatus,
  BookSummary
} from "@chaturanga/shared/types/books";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import {
  bookPageAt,
  bookPageLabel,
  bookRowState,
  bookStageLabel,
  chapterFirstPage,
  chapterReportSummary,
  fileTitle,
  formatMinutes,
  formatUsd,
  importingBooks,
  newlyDone,
  sameBookFile,
  shownBookPage
} from "./book-model";

const SHA = "a".repeat(64);

function book(patch: Partial<BookSummary> = {}): BookSummary {
  return {
    id: "b1",
    title: "Synthetic Openings",
    author: null,
    color: null,
    sourceName: "synthetic.pdf",
    sha256: SHA,
    pageCount: 10,
    pagesAdded: 10,
    missingPageIndexes: [],
    status: "running",
    stage: "ocr",
    error: null,
    costUsd: 0.1,
    repertoireId: null,
    ocrModel: "vision/model",
    structureModel: "text/model",
    chapters: [],
    createdAt: 1,
    updatedAt: 1,
    ...patch
  };
}

function event(patch: Partial<BookProgressEvent> = {}): BookProgressEvent {
  return {
    bookId: "b1",
    status: "running",
    stage: "ocr",
    done: 3,
    total: 10,
    costUsd: 0.25,
    chapter: null,
    error: null,
    ...patch
  };
}

const chapter = (index: number) => ({
  index,
  title: `Chapter ${index + 1}`,
  firstPageIndex: index * 3,
  lastPageIndex: index * 3 + 2,
  repertoireChapterId: `c${index}`,
  report: null
});

describe("bookStageLabel", () => {
  it("names each stage, and the chapter being built", () => {
    expect(bookStageLabel("ocr")).toBe("Reading pages");
    expect(bookStageLabel("outline")).toBe("Finding chapters");
    expect(bookStageLabel("lines", { index: 1 }, 9)).toBe("Building chapter 2 of 9");
    expect(bookStageLabel("lines")).toBe("Building chapters");
    expect(bookStageLabel("repair")).toBe("Repairing lines");
    expect(bookStageLabel("write")).toBe("Creating repertoire");
    expect(bookStageLabel(null)).toBe("Starting");
  });
});

describe("bookRowState", () => {
  it("follows the latest event of a running import: its stage, count and cost", () => {
    const chapters = [chapter(0), chapter(1), chapter(2)];
    expect(
      bookRowState(
        book({ chapters }),
        event({ stage: "lines", done: 4, total: 9, chapter: { index: 2, title: "C" } }),
        null
      )
    ).toStrictEqual({
      status: "running",
      label: "Building chapter 3 of 3",
      progress: { done: 4, total: 9 },
      costUsd: 0.25,
      error: null,
      actions: ["cancel", "remove"]
    });
    // Another book's event changes nothing; before any event the count isn't known.
    expect(bookRowState(book(), event({ bookId: "other" }), null)).toMatchObject({
      label: "Reading pages",
      progress: null,
      costUsd: 0.1
    });
  });

  it("takes the event's status over the listed one (the list is read again after it)", () => {
    expect(bookRowState(book(), event({ status: "paused", total: 0 }), null)).toMatchObject({
      status: "paused",
      label: "Paused · Reading pages",
      actions: ["resume", "remove"]
    });
  });

  it("shows a failure with its error and Retry", () => {
    expect(
      bookRowState(book({ status: "failed", stage: "lines", error: "Out of credits." }), null, null)
    ).toMatchObject({
      label: "Stopped · Building chapters",
      error: "Out of credits.",
      actions: ["retry", "remove"]
    });
  });

  it("counts the pages saved: by the upload under way, else as listed with Continue", () => {
    const adding = book({ status: "adding-pages", stage: null, pagesAdded: 4 });
    const upload = { phase: "saving" as const, pagesAdded: 6, pageCount: 10, error: null };
    expect(bookRowState(adding, null, upload)).toMatchObject({
      label: "Saving pages",
      progress: { done: 6, total: 10 },
      error: null,
      actions: ["cancel", "remove"]
    });
    expect(bookRowState(adding, null, null)).toMatchObject({
      progress: { done: 4, total: 10 },
      actions: ["continue", "remove"]
    });
    expect(
      bookRowState(adding, null, { ...upload, phase: "failed", error: "Disk full." })
    ).toMatchObject({ error: "Disk full.", actions: ["continue", "remove"] });
  });

  it("offers Start for a book with all its pages, with why the last start failed", () => {
    expect(
      bookRowState(book({ status: "ready", stage: null }), null, null, "No key.")
    ).toMatchObject({ label: "Pages saved", error: "No key.", actions: ["start", "remove"] });
  });
});

describe("importingBooks and newlyDone", () => {
  it("lists the books not done, and raises a notice only for one seen running before", () => {
    const books = [
      book({ id: "a", status: "done", repertoireId: "r" }),
      book({ id: "b", status: "running" }),
      book({ id: "c", status: "done", repertoireId: "r2" })
    ];
    expect(importingBooks(books).map((entry) => entry.id)).toStrictEqual(["b"]);
    const known = new Map<string, BookStatus>([
      ["a", "running"],
      ["b", "running"]
    ]);
    // "c" was never seen unfinished: it finished before this window looked.
    expect(newlyDone(known, books).map((entry) => entry.id)).toStrictEqual(["a"]);
    expect(newlyDone(new Map<string, BookStatus>([["a", "done"]]), books)).toStrictEqual([]);
  });
});

describe("continuing an upload", () => {
  it("accepts only the same file, and says which to pick", () => {
    const listed = book({ status: "adding-pages" });
    expect(sameBookFile(listed, { sha256: SHA, pageCount: 10 })).toBeNull();
    expect(sameBookFile(listed, { sha256: "b".repeat(64), pageCount: 10 })).toMatch(
      /Pick “synthetic\.pdf” again/
    );
    expect(sameBookFile(listed, { sha256: SHA, pageCount: 11 })).not.toBeNull();
  });

  it("titles a file by its name", () => {
    expect(fileTitle("My Book.PDF")).toBe("My Book");
    expect(fileTitle(".pdf")).toBe(".pdf");
  });
});

describe("formatting", () => {
  it("writes costs and times the way the dialog and rows show them", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(0.004)).toBe("< $0.01");
    expect(formatUsd(2.1)).toBe("$2.10");
    expect(formatMinutes(15)).toBe("about 15 min");
    expect(formatMinutes(130)).toBe("about 2 h 10 min");
    expect(formatMinutes(120)).toBe("about 2 h");
  });
});

/** A chapter: root → e4 ([%page 3]) → e5 → Nf3 ([%page 4]) → Nc6. */
function lookup() {
  const nodes: Partial<MoveNode>[] = [
    { id: "root", parentId: null, comment: null },
    { id: "e4", parentId: "root", comment: "[%page 3] The king's pawn." },
    { id: "e5", parentId: "e4", comment: null },
    { id: "nf3", parentId: "e5", comment: "[%page 4]" },
    { id: "nc6", parentId: "nf3", comment: "Defends." }
  ];
  return { nodesById: new Map(nodes.map((node) => [node.id!, node as MoveNode])) };
}

const pages: BookPages = {
  bookId: "b1",
  title: "Synthetic Openings",
  pages: [0, 1, 2, 3, 4].map((pageIndex) => ({
    pageIndex,
    printedPage: pageIndex === 4 ? null : pageIndex + 39,
    src: `image:${pageIndex}`,
    ocrText: "text"
  })),
  chapters: [chapter(0), chapter(1)]
};

describe("book pages in Study", () => {
  it("finds a move's page: its own, else the nearest on its path, else the chapter's first", () => {
    expect(bookPageAt(lookup(), "e4")).toBe(3);
    expect(bookPageAt(lookup(), "e5")).toBe(3);
    expect(bookPageAt(lookup(), "nc6")).toBe(4);
    expect(bookPageAt(lookup(), "root")).toBeNull();
    expect(bookPageAt(lookup(), "root", chapterFirstPage(pages, "c1"))).toBe(4);
    expect(chapterFirstPage(pages, "elsewhere")).toBeNull();
  });

  it("labels a page by its printed number, the PDF page as its title", () => {
    expect(bookPageLabel(pages, 3)).toStrictEqual({ text: "p. 41", title: "PDF page 3" });
    // No printed number read: the PDF's.
    expect(bookPageLabel(pages, 5)).toStrictEqual({ text: "p. 5", title: "PDF page 5" });
  });

  it("shows a page turned to while its move stays selected, then the move's again", () => {
    const view = { nodeId: "c0/e5", page: 5 };
    expect(shownBookPage(3, view, "c0/e5", 5)).toBe(5);
    expect(shownBookPage(3, view, "c0/nf3", 5)).toBe(3);
    expect(shownBookPage(null, null, "c0/root", 5)).toBeNull();
    // Kept within the book.
    expect(shownBookPage(9, null, "c0/e5", 5)).toBe(5);
    expect(shownBookPage(0, null, "c0/e5", 5)).toBe(1);
  });
});

describe("chapterReportSummary", () => {
  const report: BookChapterReport = {
    lines: 40,
    legalLines: 34,
    illegalLines: [
      { pageIndex: 12, printedPage: 50, label: "B2", error: "13…Rd8 isn't legal" },
      { pageIndex: 3, printedPage: 41, label: null, error: "4.Bb9 isn't a move" }
    ],
    repairedLines: 3,
    moves: 1477,
    notesAnchored: 10,
    notesUnanchored: 0,
    disambiguated: 0,
    ambiguousGuesses: 0,
    coverage: null,
    unreadablePages: [7]
  };

  it("reads as one line and lists what to check in page order", () => {
    const summary = chapterReportSummary(report);
    expect(summary.text).toBe("1,477 moves · 2 lines need a look · 1 page unread");
    expect(summary.issues.map((issue) => [issue.page, issue.label])).toStrictEqual([
      [4, null],
      [8, null],
      [13, "B2"]
    ]);
    expect(summary.issues[1].error).toMatch(/couldn't be read/);
  });

  it("says so when every line was read", () => {
    expect(
      chapterReportSummary({ ...report, moves: 1, illegalLines: [], unreadablePages: [] }).text
    ).toBe("1 move · every line read");
  });
});
