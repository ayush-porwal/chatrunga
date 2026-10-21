import { describe, expect, it } from "vitest";
import { bookChapterRanges, printedPageOf, withoutPageMarker } from "./chapters";
import type { BookOutline } from "./llm-output";

const outline = (chapters: BookOutline["chapters"], printedPageOffset = 2): BookOutline => ({
  title: "Test Book",
  author: null,
  color: "white",
  printedPageOffset,
  chapters
});

describe("printedPageOf / withoutPageMarker", () => {
  it("reads the page marker the OCR prompt ends with", () => {
    expect(printedPageOf("text\n[PAGE 41]\n")).toBe(41);
    expect(printedPageOf("text\n[PAGE ?]")).toBeNull();
    expect(printedPageOf("[PAGE 4] in the middle\nmore")).toBeNull();
    expect(withoutPageMarker("text\n[PAGE ?]")).toBe("text");
  });
});

describe("bookChapterRanges", () => {
  it("finds chapters by the printed numbers read on the pages, ending before the next one", () => {
    const pages = [
      { pageIndex: 4, printedPage: 3 },
      { pageIndex: 10, printedPage: 9 }
    ];
    expect(
      bookChapterRanges(
        outline([
          { number: 1, title: "One", firstPage: 3, lastPage: null },
          { number: 2, title: "Two", firstPage: 9, lastPage: null }
        ]),
        pages,
        20
      )
    ).toStrictEqual([
      { title: "One", firstPageIndex: 4, lastPageIndex: 9 },
      { title: "Two", firstPageIndex: 10, lastPageIndex: 19 }
    ]);
  });

  it("falls back to the offset, keeps a stated end within the next chapter, sorts by page", () => {
    expect(
      bookChapterRanges(
        outline([
          { number: 2, title: "Two", firstPage: 10, lastPage: 30 },
          { number: 1, title: "One", firstPage: 1, lastPage: 4 }
        ]),
        [],
        20
      )
    ).toStrictEqual([
      { title: "One", firstPageIndex: 2, lastPageIndex: 5 },
      { title: "Two", firstPageIndex: 11, lastPageIndex: 19 }
    ]);
  });

  it("drops chapters outside the book or on a page already taken", () => {
    expect(
      bookChapterRanges(
        outline([
          { number: 1, title: "One", firstPage: 1, lastPage: null },
          { number: 2, title: "Again", firstPage: 1, lastPage: null },
          { number: 3, title: "Beyond", firstPage: 500, lastPage: null }
        ]),
        [],
        10
      )
    ).toStrictEqual([{ title: "One", firstPageIndex: 2, lastPageIndex: 9 }]);
  });

  it("makes the whole book one chapter when the outline has none it can place", () => {
    expect(bookChapterRanges(outline([]), [], 8)).toStrictEqual([
      { title: "Test Book", firstPageIndex: 0, lastPageIndex: 7 }
    ]);
  });
});
