import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BookSummary } from "@chaturanga/shared/types/books";
import type { ChaturangaApi } from "@chaturanga/shared/ipc/chaturanga-api";
import { continueBook, importBook, runBookAction, useBookImportStore } from "./book-imports";
import type { PdfBook } from "./render-pdf";

const SHA = "a".repeat(64);

function summary(patch: Partial<BookSummary> = {}): BookSummary {
  return {
    id: "b1",
    title: "Synthetic",
    author: null,
    color: null,
    sourceName: "synthetic.pdf",
    sha256: SHA,
    pageCount: 4,
    pagesAdded: 0,
    missingPageIndexes: [0, 1, 2, 3],
    status: "adding-pages",
    stage: null,
    error: null,
    costUsd: 0,
    repertoireId: null,
    ocrModel: "vision/model",
    structureModel: "text/model",
    chapters: [],
    createdAt: 1,
    updatedAt: 1,
    ...patch
  };
}

/** A fake books API: pages are stored as asked; `addPage` can be held to inspect a run. */
function fakeBooks() {
  const added: number[] = [];
  const calls: string[] = [];
  let hold: Promise<void> | null = null;
  const api = {
    create: vi.fn(async () => summary()),
    addPage: vi.fn(async ({ pageIndex }: { pageIndex: number }) => {
      if (hold) await hold;
      added.push(pageIndex);
      return summary({ pagesAdded: added.length });
    }),
    start: vi.fn(async () => {
      calls.push("start");
      return summary({ status: "running" });
    }),
    resume: vi.fn(async () => {
      calls.push("resume");
      return summary({ status: "running" });
    }),
    cancel: vi.fn(async () => summary({ status: "paused" })),
    remove: vi.fn(async () => {
      calls.push(`remove after ${added.length} pages`);
    })
  };
  return {
    api,
    added,
    calls,
    holdPages: () => {
      let release!: () => void;
      hold = new Promise((resolve) => (release = resolve));
      return () => {
        hold = null;
        release();
      };
    }
  };
}

function fakePdf(): PdfBook & { closed: () => boolean; rendered: number[] } {
  let closed = false;
  const rendered: number[] = [];
  return {
    pageCount: 4,
    metadataTitle: null,
    sha256: SHA,
    renderPage: async (pageIndex) => {
      rendered.push(pageIndex);
      return new Uint8Array([pageIndex]);
    },
    close: async () => {
      closed = true;
    },
    closed: () => closed,
    rendered
  };
}

let books: ReturnType<typeof fakeBooks>;
const queryClient = new QueryClient();

describe("book imports", () => {
  beforeEach(() => {
    books = fakeBooks();
    vi.stubGlobal("window", {
      chaturanga: { books: books.api as unknown as ChaturangaApi["books"] }
    });
    useBookImportStore.setState({
      events: {},
      uploads: {},
      errors: {},
      known: new Map(),
      ready: [],
      busy: new Set()
    });
  });

  it("creates the book, sends every page in order, then starts it and lets the PDF go", async () => {
    const pdf = fakePdf();
    const release = books.holdPages();
    const created = await importBook({
      pdf,
      sourceName: "synthetic.pdf",
      title: "Mine",
      queryClient
    });
    expect(created.id).toBe("b1");
    expect(books.api.create).toHaveBeenCalledWith({
      sourceName: "synthetic.pdf",
      pageCount: 4,
      metadataTitle: null,
      sha256: SHA,
      title: "Mine"
    });
    // Saving runs on its own: the row counts the pages as they are stored.
    expect(useBookImportStore.getState().uploads.b1).toMatchObject({ phase: "saving" });
    release();
    await vi.waitFor(() => expect(books.calls).toStrictEqual(["start"]));
    expect(books.added).toStrictEqual([0, 1, 2, 3]);
    expect(pdf.closed()).toBe(true);
    expect(useBookImportStore.getState().uploads.b1).toBeUndefined();
  });

  it("continues an interrupted upload with only the pages still missing", async () => {
    const pdf = fakePdf();
    await continueBook(summary({ pagesAdded: 2, missingPageIndexes: [1, 3] }), pdf, queryClient);
    expect(pdf.rendered).toStrictEqual([1, 3]);
    expect(books.added).toStrictEqual([1, 3]);
    expect(books.calls).toStrictEqual(["start"]);
  });

  it("starts or resumes a book that has all its pages, without rendering any", async () => {
    const pdf = fakePdf();
    await continueBook(summary({ status: "paused", missingPageIndexes: [] }), pdf, queryClient);
    expect(books.calls).toStrictEqual(["resume"]);
    expect(pdf.rendered).toStrictEqual([]);
    expect(pdf.closed()).toBe(true);
  });

  it("cancels an upload between pages: the book keeps what was sent, to continue later", async () => {
    const pdf = fakePdf();
    const release = books.holdPages();
    const running = continueBook(summary(), pdf, queryClient);
    await vi.waitFor(() => expect(books.api.addPage).toHaveBeenCalledTimes(1));
    await runBookAction("b1", "cancel", queryClient);
    release();
    await running;
    expect(books.added).toStrictEqual([0]);
    expect(books.calls).toStrictEqual([]);
    expect(books.api.cancel).not.toHaveBeenCalled();
    expect(useBookImportStore.getState().uploads.b1).toBeUndefined();
  });

  it("removes a book only once the page being sent is stored", async () => {
    const release = books.holdPages();
    const running = continueBook(summary(), fakePdf(), queryClient);
    await vi.waitFor(() => expect(books.api.addPage).toHaveBeenCalledTimes(1));
    const removing = runBookAction("b1", "remove", queryClient);
    release();
    await Promise.all([running, removing]);
    expect(books.calls).toStrictEqual(["remove after 1 pages"]);
  });

  it("keeps why an action failed as the book's error, and clears it on the next one", async () => {
    books.api.start.mockRejectedValueOnce(
      new Error("Error invoking remote method 'books:start': Error: Add an OpenRouter API key.")
    );
    await runBookAction("b1", "start", queryClient);
    expect(useBookImportStore.getState().errors.b1).toBe("Add an OpenRouter API key.");
    expect(useBookImportStore.getState().busy.has("b1")).toBe(false);
    await runBookAction("b1", "start", queryClient);
    expect(useBookImportStore.getState().errors.b1).toBeUndefined();
  });

  it("raises a ready notice for a book seen unfinished that is now done", () => {
    const store = useBookImportStore.getState();
    store.observe([summary({ status: "running" })]);
    store.observe([summary({ status: "done", repertoireId: "r1", title: "Synthetic Openings" })]);
    expect(useBookImportStore.getState().ready).toStrictEqual([
      { bookId: "b1", title: "Synthetic Openings", repertoireId: "r1" }
    ]);
    useBookImportStore.getState().dismissReady("b1");
    expect(useBookImportStore.getState().ready).toStrictEqual([]);
  });
});
