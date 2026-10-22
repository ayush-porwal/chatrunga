import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookProgressEvent } from "@chaturanga/shared/types/books";
import { bookAnswer, PAGE_TEXT, promptKind } from "./__fixtures__/fake-book";
import type { BookChatRequest } from "./openrouter-chat";

const env = await vi.hoisted(async () => import("../repertoire/__fixtures__/service-env"));
vi.mock("electron", () => env.electronModule);

const { closeDb, getDb } = await import("../db");
const { createBookStore } = await import("./book-store");
const { createBookService } = await import("./book-service");
const { bookPageFiles } = await import("./page-files");
const { writeBookRepertoire } = await import("./book-repertoire");

const root = join(env.userData, "books");
const store = createBookStore(getDb);
const files = bookPageFiles(root, () => undefined);
const SHA = "a".repeat(64);

/** A page image as the renderer sends it (a real WebP header, so it passes the bytes check). */
const page = (index: number) => new Uint8Array(Buffer.from(`RIFF\0\0\0\0WEBPpage ${index}`));

/** The page an OCR request's image is (the stored bytes end with "page N"). */
function pageOf(request: BookChatRequest): number {
  const url = /base64,([^"]+)/.exec(JSON.stringify(request.messages[0].content))?.[1] ?? "";
  return Number(/page (\d+)$/.exec(Buffer.from(url, "base64").toString())?.[1]);
}

function service(
  overrides: {
    chat?: () => Promise<unknown>;
    /** Runs before each request is answered. */
    before?: (request: BookChatRequest) => Promise<void>;
  } = {}
) {
  const events: BookProgressEvent[] = [];
  const allowFolder = vi.fn();
  const chatRequests: BookChatRequest[] = [];
  const books = createBookService({
    store,
    files,
    chat: async () => {
      await overrides.chat?.();
      return async (request: BookChatRequest) => {
        chatRequests.push(request);
        await overrides.before?.(request);
        const text =
          promptKind(request) === "ocr" ? PAGE_TEXT[pageOf(request)] : bookAnswer(request);
        return { text, costUsd: 0.5 };
      };
    },
    models: async () => ({ ocr: "vision/model", structure: "text/model" }),
    prices: {
      pricesFor: async () => ({
        prices: [
          { prompt: 1e-6, completion: 2e-6, image: 0 },
          { prompt: 1e-6, completion: 4e-6, image: 0 }
        ],
        source: "live" as const
      })
    },
    writeRepertoire: writeBookRepertoire,
    progress: (event) => events.push(event),
    allowFolder,
    imageSrc: (path) => `image:${path}`,
    log: () => undefined,
    job: { sleep: async () => undefined, concurrency: { ocr: 1 } }
  });
  return { books, events, allowFolder, chatRequests };
}

/** While held, a request stays out until it is cancelled (as fetch would). */
function holdRequests() {
  let held = true;
  let asked!: () => void;
  const requestOut = new Promise<void>((resolve) => (asked = resolve));
  return {
    requestOut,
    release: () => (held = false),
    before: (request: BookChatRequest) => {
      if (!held) return Promise.resolve();
      asked();
      return new Promise<void>((_resolve, reject) =>
        request.signal.addEventListener("abort", () => reject(request.signal.reason))
      );
    }
  };
}

async function addAllPages(books: ReturnType<typeof service>["books"], bookId: string) {
  for (let index = 0; index < PAGE_TEXT.length; index += 1) {
    await books.addPage({ bookId, pageIndex: index, bytes: page(index) });
  }
}

const create = (books: ReturnType<typeof service>["books"]) =>
  books.create({ sourceName: "Synthetic.pdf", pageCount: 4, metadataTitle: null, sha256: SHA });

describe("book service", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM books");
    getDb().exec("DELETE FROM repertoires");
    rmSync(root, { recursive: true, force: true });
  });

  afterAll(() => {
    closeDb();
    rmSync(env.userData, { recursive: true, force: true });
  });

  it("estimates with the models' prices", async () => {
    const { books } = service();
    await expect(books.estimate({ pageCount: 100 })).resolves.toMatchObject({
      pageCount: 100,
      ocrModel: "vision/model",
      structureModel: "text/model",
      prices: "live",
      minutes: 15
    });
  });

  it("creates a book from the file name, and continues the same file's unfinished import", async () => {
    const { books } = service();
    const created = await create(books);
    expect(created).toMatchObject({
      title: "Synthetic",
      status: "adding-pages",
      pageCount: 4,
      pagesAdded: 0
    });
    await expect(create(books)).resolves.toMatchObject({ id: created.id });
    expect(created).toMatchObject({ sha256: SHA, missingPageIndexes: [0, 1, 2, 3] });
    await expect(
      books.create({ sourceName: "x.pdf", pageCount: 9, metadataTitle: "Own title", sha256: SHA })
    ).resolves.toMatchObject({ title: "Own title", pageCount: 9 });
  });

  it("names the pages still missing, so an interrupted upload sends only those", async () => {
    const { books } = service();
    const { id } = await create(books);
    await books.addPage({ bookId: id, pageIndex: 0, bytes: page(0) });
    await books.addPage({ bookId: id, pageIndex: 2, bytes: page(2) });
    await expect(create(books)).resolves.toMatchObject({
      id,
      status: "adding-pages",
      pagesAdded: 2,
      missingPageIndexes: [1, 3]
    });
  });

  it("keeps a title the user chose, on a continued import and after the pages are read", async () => {
    const { books } = service();
    const { id } = await create(books);
    await expect(
      books.create({
        sourceName: "Synthetic.pdf",
        pageCount: 4,
        metadataTitle: null,
        sha256: SHA,
        title: "My openings book"
      })
    ).resolves.toMatchObject({ id, title: "My openings book" });
    await addAllPages(books, id);
    await books.start(id);
    await vi.waitFor(() => expect(books.get(id)?.status).toBe("done"));
    // The outline read "Synthetic Openings"; the chosen title names the book and its repertoire.
    expect(books.get(id)).toMatchObject({ title: "My openings book", author: "A. Writer" });
    expect(getDb().prepare("SELECT name FROM repertoires").get()).toMatchObject({
      name: "My openings book"
    });
  });

  it("stores the pages, is ready with all of them, and refuses bytes that aren't an image", async () => {
    const { books } = service();
    const { id } = await create(books);
    await expect(books.start(id)).rejects.toThrow("can't start now");
    await addAllPages(books, id);
    await addAllPages(books, id);
    expect(books.get(id)).toMatchObject({ status: "ready", pagesAdded: 4 });
    expect(readdirSync(join(root, id))).toHaveLength(4);
    await expect(
      books.addPage({ bookId: id, pageIndex: 0, bytes: new TextEncoder().encode("<html>") })
    ).rejects.toThrow("WebP, PNG or JPEG");
    await expect(books.addPage({ bookId: id, pageIndex: 4, bytes: page(4) })).rejects.toThrow(
      "no such page"
    );
  });

  it("runs the import, then serves the repertoire's book pages", async () => {
    const { books, events, allowFolder } = service();
    const { id } = await create(books);
    await addAllPages(books, id);
    await expect(books.start(id)).resolves.toMatchObject({ status: "running" });
    await vi.waitFor(() => expect(books.get(id)?.status).toBe("done"));
    const book = books.get(id)!;
    expect(book).toMatchObject({ title: "Synthetic Openings", color: "white", costUsd: 5 });
    expect(book.chapters.map((chapter) => chapter.title)).toStrictEqual(["Chapter A", "Chapter B"]);
    expect(events).toContainEqual(
      expect.objectContaining({ stage: "lines", chapter: { index: 0, title: "Chapter A" } })
    );

    const pages = (await books.pages(book.repertoireId!))!;
    expect(pages).toMatchObject({ bookId: id, title: "Synthetic Openings" });
    expect(pages.chapters).toStrictEqual(book.chapters);
    expect(pages.chapters[0]).toMatchObject({
      title: "Chapter A",
      repertoireChapterId: expect.any(String),
      report: expect.objectContaining({ moves: expect.any(Number) })
    });
    expect(pages.pages.map(({ pageIndex, printedPage }) => [pageIndex, printedPage])).toStrictEqual(
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4]
      ]
    );
    expect(pages.pages[0].src).toMatch(/^image:.*p0001-[0-9a-f]{16}\.webp$/);
    expect(allowFolder).toHaveBeenCalledWith(join(root, id));
    await expect(books.pages("another-repertoire")).resolves.toBeNull();

    // A page whose image file went missing is served without one.
    rmSync(store.pages(id)[1].imageFile);
    const after = (await books.pages(book.repertoireId!))!;
    expect(after.pages.map((entry) => entry.src === null)).toStrictEqual([
      false,
      true,
      false,
      false
    ]);
  });

  it("refuses to start without a usable key, leaving the book as it was", async () => {
    const { books } = service({
      chat: async () => {
        throw new Error("Add an OpenRouter API key");
      }
    });
    const { id } = await create(books);
    await addAllPages(books, id);
    await expect(books.start(id)).rejects.toThrow("API key");
    expect(books.get(id)?.status).toBe("ready");
  });

  it("cancels a running import (it pauses) and resumes it to the end", async () => {
    const gate = holdRequests();
    const { books } = service({ before: gate.before });
    const { id } = await create(books);
    await addAllPages(books, id);
    await books.start(id);
    await gate.requestOut;
    await expect(books.cancel(id)).resolves.toMatchObject({ status: "paused" });
    gate.release();
    await expect(books.resume(id)).resolves.toMatchObject({ status: "running" });
    await vi.waitFor(() => expect(books.get(id)?.status).toBe("done"));
  });

  it("marks imports interrupted by a restart as paused", async () => {
    const { books } = service();
    const { id } = await create(books);
    store.update(id, { status: "running" }, 2);
    books.recoverInterrupted();
    expect(books.get(id)?.status).toBe("paused");
  });

  it("removes a book with its pages, and sweeps folders of books that are gone", async () => {
    const { books } = service();
    const { id } = await create(books);
    await addAllPages(books, id);
    mkdirSync(join(root, "gone-book"), { recursive: true });
    await expect(books.sweep()).resolves.toBe(1);
    expect(existsSync(join(root, id))).toBe(true);
    await books.remove(id);
    expect(books.get(id)).toBeNull();
    expect(existsSync(join(root, id))).toBe(false);
  });
});
