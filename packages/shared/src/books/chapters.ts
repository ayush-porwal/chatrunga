/**
 * Where the outline's chapters (printed page numbers, from the table of contents) are in the PDF,
 * and the printed page number a page shows (`[PAGE n]`, the OCR prompt's last line).
 */
import type { BookOutline } from "./llm-output";

export type BookChapterRange = { title: string; firstPageIndex: number; lastPageIndex: number };

/** The printed page number the OCR text ends with (`[PAGE 41]`), or null. */
export function printedPageOf(ocrText: string): number | null {
  const match = /\[PAGE\s+(\d{1,5})\]\s*$/i.exec(ocrText.trim());
  return match ? Number(match[1]) : null;
}

/** The OCR text without its page marker. */
export function withoutPageMarker(ocrText: string): string {
  return ocrText.replace(/\[PAGE\s+[^\]]*\]\s*$/i, "").trim();
}

/**
 * Each chapter's 0-based PDF pages. A chapter starts at the page that reads its first printed
 * page, else at `printed + offset`; it ends where it says, else before the next chapter, else at
 * the book's end. Chapters that land outside the book or before the previous one are dropped; a
 * book without usable chapters is one chapter, titled after the book.
 */
export function bookChapterRanges(
  outline: BookOutline,
  pages: readonly { pageIndex: number; printedPage: number | null }[],
  pageCount: number
): BookChapterRange[] {
  const indexOfPrinted = new Map<number, number>();
  for (const page of pages) {
    if (page.printedPage !== null && !indexOfPrinted.has(page.printedPage)) {
      indexOfPrinted.set(page.printedPage, page.pageIndex);
    }
  }
  const locate = (printed: number) =>
    indexOfPrinted.get(printed) ?? printed + outline.printedPageOffset - 1;
  const starts = outline.chapters
    .map((chapter) => ({ chapter, first: locate(chapter.firstPage) }))
    .filter(({ first }) => first >= 0 && first < pageCount)
    .sort((a, b) => a.first - b.first);
  const ranges: BookChapterRange[] = [];
  starts.forEach(({ chapter, first }, index) => {
    if (ranges.some((range) => range.firstPageIndex === first)) return;
    const nextFirst = starts.slice(index + 1).find((next) => next.first > first)?.first;
    const limit = (nextFirst ?? pageCount) - 1;
    const printedLast = chapter.lastPage === null ? null : locate(chapter.lastPage);
    const last =
      printedLast !== null && printedLast >= first ? Math.min(printedLast, limit) : limit;
    ranges.push({ title: chapter.title, firstPageIndex: first, lastPageIndex: last });
  });
  if (ranges.length) return ranges;
  return [{ title: outline.title, firstPageIndex: 0, lastPageIndex: Math.max(0, pageCount - 1) }];
}
