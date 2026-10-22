import { describe, expect, it } from "vitest";
import { estimateBookImport, FALLBACK_MODEL_PRICES } from "./estimate";
import {
  bookCommentProse,
  bookPageOf,
  editedBookComment,
  stripBookPage,
  withBookPage
} from "./book-page";
import {
  bookLinesMessages,
  bookOcrMessages,
  bookOutlineMessages,
  bookRepairMessages,
  type ChatContentPart
} from "./prompts";
import { DEFAULT_BOOK_OCR_MODEL, DEFAULT_COMMENTARY_MODEL } from "../llm/models";

const textOf = (content: unknown) => JSON.stringify(content);

describe("book prompts", () => {
  it("sends the page image with the OCR instructions", () => {
    const [message] = bookOcrMessages("data:image/webp;base64,AAAA");
    expect(message.content).toContainEqual({
      type: "image_url",
      image_url: { url: "data:image/webp;base64,AAAA" }
    });
  });

  it("asks for lines from the book's side, with where the book is and the page before", () => {
    const messages = bookLinesMessages({
      book: { title: "Test Book", author: null, color: "black" },
      context: { game: null, mainLine: "1. d4 Nf6" },
      previousPage: null,
      page: "page text"
    });
    expect(textOf(messages[0].content)).toContain("a repertoire for BLACK");
    expect(textOf(messages[1].content)).toContain("Main line so far: 1. d4 Nf6");
    expect(textOf(messages[1].content)).toContain("(chapter start)");
  });

  it("names the game being annotated", () => {
    const messages = bookLinesMessages({
      book: { title: "Test Book", author: "A. Writer", color: "white" },
      context: { game: { white: "Alpha", black: "Beta", event: "", year: "2001" }, mainLine: null },
      previousPage: "end of page",
      page: "page text"
    });
    expect(textOf(messages[1].content)).toContain("Current game: Alpha - Beta, 2001");
  });

  it("numbers the outline's pages by their PDF page", () => {
    const [, user] = bookOutlineMessages({
      metadataTitle: null,
      pages: [{ pdfPage: 3, text: "Contents" }]
    });
    expect(user.content).toBe("PDF TITLE: (none)\n\n=== PDF PAGE 3 ===\nContents");
  });

  it("gives a repair the failing move, the position, its legal moves and both pages", () => {
    const [message] = bookRepairMessages({
      label: null,
      printedPage: 12,
      moves: "1. e4 e5 2. Bxh7",
      error: 'illegal or unreadable move "Bxh7" after 1. e4 e5',
      fenBefore: "fen-before",
      legalSans: ["Nf3", "d4"],
      images: ["data:page", "data:previous"]
    });
    const [text, ...images] = message.content as ChatContentPart[];
    expect(text).toMatchObject({ type: "text" });
    expect(textOf(text)).toContain('PROBLEM: illegal or unreadable move \\"Bxh7\\"\\n');
    expect(textOf(text)).toContain("LEGAL MOVES THERE: Nf3 d4");
    expect(textOf(text)).toContain("label main, book page 12");
    expect(images).toStrictEqual([
      { type: "image_url", image_url: { url: "data:page" } },
      { type: "image_url", image_url: { url: "data:previous" } }
    ]);
  });
});

describe("estimateBookImport", () => {
  it("scales with the page count at the models' prices", () => {
    const prices = {
      ocrPrice: FALLBACK_MODEL_PRICES[DEFAULT_BOOK_OCR_MODEL]!,
      structurePrice: FALLBACK_MODEL_PRICES[DEFAULT_COMMENTARY_MODEL]!
    };
    const book = estimateBookImport({ pageCount: 352, ...prices });
    expect(book.costUsd).toBeGreaterThan(2);
    expect(book.costUsd).toBeLessThan(5);
    expect(book.minutes).toBe(59);
    expect(estimateBookImport({ pageCount: 0, ...prices })).toStrictEqual({
      costUsd: 0,
      minutes: 1
    });
  });
});

describe("book page commands", () => {
  it("reads, strips and sets a comment's page", () => {
    expect(bookPageOf("[%page 12] A note.")).toBe(12);
    expect(bookPageOf("A note.")).toBeNull();
    expect(stripBookPage("[%page 12] A note.")).toBe("A note.");
    expect(stripBookPage("[%page 12]")).toBeNull();
    expect(withBookPage("[%page 3] A note.", 7)).toBe("[%page 7] A note.");
    expect(withBookPage(null, 7)).toBe("[%page 7]");
    expect(withBookPage("A note.", null)).toBe("A note.");
  });

  it("edits a comment's text as typed, keeping its page in front", () => {
    expect(bookCommentProse("[%page 12] A note, ")).toBe("A note, ");
    expect(bookCommentProse("[%page 12]")).toBe("");
    expect(bookCommentProse(null)).toBe("");
    expect(editedBookComment("[%page 12] A note.", "A note, then ")).toBe(
      "[%page 12] A note, then "
    );
    // Cleared: the page stays (the move keeps its link to the book).
    expect(editedBookComment("[%page 12] A note.", "  ")).toBe("[%page 12]");
    expect(editedBookComment("Plain.", "Plain, ")).toBe("Plain, ");
    expect(editedBookComment(null, "")).toBe("");
  });
});
