import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { ChaturangaApi } from "@chaturanga/shared/ipc/chaturanga-api";

/**
 * Imported chess books through `window.chaturanga.books` (main/books runs the import). Keys:
 * `['books','list']`, `['books','pages',repertoireId]`, `['books','estimate',pageCount]`.
 * Progress arrives on `books.onProgress` (features/books/book-imports.ts useBookProgress), which
 * reads the list again when a book's status changes. Nothing is available in the web preview (no `window.chaturanga`).
 */
const bookKeys = {
  list: ["books", "list"] as const,
  pages: (repertoireId: string) => ["books", "pages", repertoireId] as const,
  estimate: (pageCount: number) => ["books", "estimate", pageCount] as const
};

export function booksApi(): ChaturangaApi["books"] | undefined {
  return window.chaturanga?.books;
}

export function requireBooksApi(): ChaturangaApi["books"] {
  const api = booksApi();
  if (!api) throw new Error("Importing a book needs the desktop app.");
  return api;
}

/** Reads the books again (their rows on the hub, and which finished). */
export function invalidateBooks(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: bookKeys.list });
}

/** Every book, newest first. */
export function useBooksQuery() {
  return useQuery({
    queryKey: bookKeys.list,
    queryFn: () => booksApi()?.list() ?? [],
    enabled: Boolean(booksApi())
  });
}

/** A repertoire's book pages (only asked for a repertoire imported from a book: `isBook`). */
export function useBookPagesQuery(repertoireId: string, isBook: boolean) {
  return useQuery({
    queryKey: bookKeys.pages(repertoireId),
    queryFn: () => booksApi()?.getPages(repertoireId) ?? null,
    enabled: isBook && Boolean(booksApi()),
    // A finished book's pages don't change.
    staleTime: Infinity
  });
}

/** What importing `pageCount` pages would cost and take (null: no file yet). */
export function useBookEstimateQuery(pageCount: number | null) {
  return useQuery({
    queryKey: bookKeys.estimate(pageCount ?? 0),
    queryFn: () => requireBooksApi().estimate({ pageCount: pageCount ?? 0 }),
    enabled: pageCount !== null && pageCount > 0 && Boolean(booksApi()),
    retry: false
  });
}
