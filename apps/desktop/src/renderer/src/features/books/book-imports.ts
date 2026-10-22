/**
 * The book imports this window drives, kept outside any component so closing the dialog or leaving
 * the hub never stops them: rendering a PDF's pages and sending them (`books.addPage`), then
 * starting the import, which main runs. The store holds what the hub's rows add to the book list:
 * the latest progress event per book, this window's page uploads, an action's error, and the
 * "… is ready" notices of books that finished.
 */
import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import type { BookProgressEvent, BookStatus, BookSummary } from "@chaturanga/shared/types/books";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { booksApi, invalidateBooks, requireBooksApi } from "../../queries/books";
import { invalidateSummaries } from "../../queries/repertoire";
import { newlyDone, type BookAction, type BookUpload } from "./book-model";
import { renderPdfPages, type PdfBook } from "./render-pdf";

/** A finished book's notice on the hub. */
type BookReadyNotice = { bookId: string; title: string; repertoireId: string };

type BookImportStore = {
  events: Partial<Record<string, BookProgressEvent>>;
  uploads: Partial<Record<string, BookUpload>>;
  /** Why the last action on a book failed (Start without a usable key, say). */
  errors: Partial<Record<string, string>>;
  /** Each book's status when last listed (a change to `done` raises its notice). */
  known: ReadonlyMap<string, BookStatus>;
  ready: BookReadyNotice[];
  /** Book ids with an action under way (their buttons wait). */
  busy: ReadonlySet<string>;
  applyProgress: (event: BookProgressEvent) => void;
  /** The books as listed now: the ones that finished since get their notice. */
  observe: (books: readonly BookSummary[]) => void;
  dismissReady: (bookId: string) => void;
};

export const useBookImportStore = create<BookImportStore>((set) => ({
  events: {},
  uploads: {},
  errors: {},
  known: new Map(),
  ready: [],
  busy: new Set(),
  applyProgress: (event) =>
    set((state) => ({ events: { ...state.events, [event.bookId]: event } })),
  observe: (books) =>
    set((state) => {
      const finished = newlyDone(state.known, books).filter(
        (book): book is BookSummary & { repertoireId: string } => book.repertoireId !== null
      );
      return {
        known: new Map(books.map((book) => [book.id, book.status])),
        ready: [
          ...state.ready.filter((notice) => !finished.some((book) => book.id === notice.bookId)),
          ...finished.map((book) => ({
            bookId: book.id,
            title: book.title,
            repertoireId: book.repertoireId
          }))
        ]
      };
    }),
  dismissReady: (bookId) =>
    set((state) => ({ ready: state.ready.filter((notice) => notice.bookId !== bookId) }))
}));

const store = () => useBookImportStore.getState();

function patchBook(
  bookId: string,
  patch: { upload?: BookUpload | null; error?: string | null; busy?: boolean; event?: null }
): void {
  useBookImportStore.setState((state) => {
    const next: Partial<BookImportStore> = {};
    if (patch.upload !== undefined) {
      const uploads = { ...state.uploads };
      if (patch.upload) uploads[bookId] = patch.upload;
      else delete uploads[bookId];
      next.uploads = uploads;
    }
    if (patch.error !== undefined) {
      const errors = { ...state.errors };
      if (patch.error) errors[bookId] = patch.error;
      else delete errors[bookId];
      next.errors = errors;
    }
    if (patch.busy !== undefined) {
      const busy = new Set(state.busy);
      if (patch.busy) busy.add(bookId);
      else busy.delete(bookId);
      next.busy = busy;
    }
    if (patch.event === null) {
      const events = { ...state.events };
      delete events[bookId];
      next.events = events;
    }
    return next;
  });
}

/** The page uploads running, by book: cancelled through `controller`, settled with `finished`. */
const uploads = new Map<string, { controller: AbortController; finished: Promise<void> }>();

const closeQuietly = (pdf: PdfBook) => void pdf.close().catch(() => undefined);

/**
 * Starts importing an opened PDF: the book is created (or the unfinished import of the same file
 * is found), then its pages are sent and the import starts, on its own. Resolves with the book
 * once created, the PDF then belongs to the import; rejects (the PDF still the caller's) when it
 * can't be created.
 */
export async function importBook(input: {
  pdf: PdfBook;
  sourceName: string;
  title: string | null;
  queryClient: QueryClient;
}): Promise<BookSummary> {
  const { pdf, queryClient } = input;
  const book = await requireBooksApi().create({
    sourceName: input.sourceName,
    pageCount: pdf.pageCount,
    metadataTitle: pdf.metadataTitle,
    sha256: pdf.sha256,
    title: input.title
  });
  invalidateBooks(queryClient);
  void continueBook(book, pdf, queryClient);
  return book;
}

/**
 * Carries on with a book whose PDF (the same file) is open: sends the pages it is missing, then
 * starts it; or starts or resumes it when it has them all. The PDF is closed when done with.
 */
export async function continueBook(
  book: BookSummary,
  pdf: PdfBook,
  queryClient: QueryClient
): Promise<void> {
  if (book.status === "adding-pages" && !uploads.has(book.id)) {
    const controller = new AbortController();
    const finished = uploadPages(book, pdf, controller.signal, queryClient);
    uploads.set(book.id, { controller, finished });
    await finished;
    return;
  }
  closeQuietly(pdf);
  if (book.status === "ready") await runBookAction(book.id, "start", queryClient);
  else if (book.status === "paused" || book.status === "failed")
    await runBookAction(book.id, "resume", queryClient);
}

async function uploadPages(
  book: BookSummary,
  pdf: PdfBook,
  signal: AbortSignal,
  queryClient: QueryClient
): Promise<void> {
  const api = requireBooksApi();
  const upload: BookUpload = {
    phase: "saving",
    pagesAdded: book.pagesAdded,
    pageCount: book.pageCount,
    error: null
  };
  patchBook(book.id, { upload, error: null });
  let saved = false;
  try {
    await renderPdfPages(pdf, {
      pageIndexes: book.missingPageIndexes,
      signal,
      onPage: async (page) => {
        const summary = await api.addPage({ bookId: book.id, ...page });
        patchBook(book.id, { upload: { ...upload, pagesAdded: summary.pagesAdded } });
      }
    });
    saved = true;
  } catch (error) {
    patchBook(book.id, {
      upload: signal.aborted
        ? null
        : {
            ...upload,
            phase: "failed",
            error: ipcErrorMessage(error) || "The book's pages couldn't be saved."
          }
    });
  } finally {
    uploads.delete(book.id);
    closeQuietly(pdf);
    invalidateBooks(queryClient);
  }
  if (!saved) return;
  patchBook(book.id, { upload: null });
  await runBookAction(book.id, "start", queryClient);
}

const ACTION_FAILURES: Record<BookAction, string> = {
  cancel: "Couldn't stop the import.",
  start: "Couldn't start the import.",
  resume: "Couldn't resume the import.",
  retry: "Couldn't resume the import.",
  continue: "Couldn't continue the import.",
  remove: "Couldn't remove the book."
};

/**
 * A book row's action (Continue picks the file again, in the dialog). Never rejects: a failure
 * is kept as the book's error.
 */
export async function runBookAction(
  bookId: string,
  action: Exclude<BookAction, "continue">,
  queryClient: QueryClient
): Promise<void> {
  const api = booksApi();
  if (!api) return;
  const upload = uploads.get(bookId);
  if (upload && (action === "cancel" || action === "remove")) {
    // Stops sending pages (the book stays, to continue later): what was sent is kept.
    upload.controller.abort();
    if (action === "cancel") return;
  }
  patchBook(bookId, { busy: true, error: null });
  try {
    // Removing waits for the page being sent, so none is stored after the book is gone.
    await upload?.finished;
    if (action === "cancel") await api.cancel(bookId);
    else if (action === "remove") await api.remove(bookId);
    else {
      // The event that stopped it is older than the run this starts.
      patchBook(bookId, { event: null });
      await (action === "start" ? api.start(bookId) : api.resume(bookId));
    }
    if (action === "remove") patchBook(bookId, { upload: null, event: null });
  } catch (error) {
    patchBook(bookId, { error: ipcErrorMessage(error) || ACTION_FAILURES[action] });
  } finally {
    patchBook(bookId, { busy: false });
    invalidateBooks(queryClient);
  }
}

/**
 * Follows the running imports while mounted (the hub): each event updates its book's row; a status
 * change reads the list again, and a book that finished reads the repertoires again.
 */
export function useBookProgress(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const unsubscribe = booksApi()?.onProgress((event) => {
      const previous = store().events[event.bookId];
      store().applyProgress(event);
      if (previous?.status === event.status) return;
      invalidateBooks(queryClient);
      if (event.status === "done") invalidateSummaries(queryClient);
    });
    return () => unsubscribe?.();
  }, [queryClient]);
}
