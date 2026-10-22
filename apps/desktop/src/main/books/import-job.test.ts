import { rmSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookProgressEvent } from "@chaturanga/shared/types/books";
import { bookPageOf } from "@chaturanga/shared/books/book-page";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import {
  bookAnswer,
  fakeFiles,
  ILLEGAL_LINE,
  imageFile,
  PAGE_TEXT,
  promptKind,
  REPAIRED_LINE,
  userText
} from "./__fixtures__/fake-book";
import type { BookChatRequest } from "./openrouter-chat";

const env = await vi.hoisted(async () => import("../repertoire/__fixtures__/service-env"));
vi.mock("electron", () => env.electronModule);

const { closeDb, getDb } = await import("../db");
const { createBookStore } = await import("./book-store");
const { runBookImport } = await import("./import-job");
const { BookChatError } = await import("./openrouter-chat");
const { writeBookRepertoire } = await import("./book-repertoire");
const { getChapter, getRepertoire } = await import("../repertoire/service");

const store = createBookStore(getDb);
const BOOK = "book-1";

function addBook(): void {
  store.insert({
    id: BOOK,
    title: "synthetic.pdf",
    titleChosen: false,
    author: null,
    color: null,
    pageCount: PAGE_TEXT.length,
    printedPageOffset: null,
    sourceName: "synthetic.pdf",
    metadataTitle: null,
    sha256: "0".repeat(64),
    status: "ready",
    ocrModel: "vision/model",
    structureModel: "text/model",
    createdAt: 1,
    updatedAt: 1
  });
  PAGE_TEXT.forEach((_text, index) => store.putPage(BOOK, index, imageFile("/books", index)));
}

/** A fake OpenRouter: the scripted answers at $0.01 each, every request kept. */
function fakeChat(override?: (request: BookChatRequest) => string | undefined) {
  const requests: BookChatRequest[] = [];
  const chat = vi.fn(async (request: BookChatRequest) => {
    requests.push(request);
    return { text: override?.(request) ?? bookAnswer(request), costUsd: 0.01 };
  });
  const kinds = () => requests.map(promptKind);
  return { chat, requests, kinds };
}

function deps(chat: ReturnType<typeof fakeChat>["chat"], events: BookProgressEvent[] = []) {
  return {
    store,
    files: fakeFiles,
    chat,
    writeRepertoire: writeBookRepertoire,
    progress: (event: BookProgressEvent) => events.push(event),
    sleep: vi.fn<(ms: number, signal: AbortSignal) => Promise<void>>(async () => undefined)
  };
}

/** The lines requests for page `index`. */
const linesFor = (requests: readonly BookChatRequest[], index: number) =>
  requests.filter(
    (request) => promptKind(request) === "lines" && userText(request).endsWith(PAGE_TEXT[index])
  );

/** Answers page `index`'s lines request with `text` (the others as scripted). */
const linesAnswer = (index: number, text: string) => (request: BookChatRequest) =>
  linesFor([request], index).length ? text : undefined;

/** Cancels through `controller` once page `index`'s lines are asked for; that request rejects. */
function cancellingAt(index: number, controller: AbortController, requests: BookChatRequest[]) {
  return async (request: BookChatRequest) => {
    requests.push(request);
    if (linesFor([request], index).length) {
      controller.abort();
      request.signal.throwIfAborted();
    }
    return { text: bookAnswer(request), costUsd: 0.01 };
  };
}

/** Rate limited `busy` times, then out of credits at the outline. */
function failingChat(busy: number) {
  let left = busy;
  return async (request: BookChatRequest) => {
    if (left-- > 0) throw new BookChatError("rate limited", true);
    if (promptKind(request) === "outline") throw new BookChatError("Out of credits.", false);
    return { text: bookAnswer(request), costUsd: 0 };
  };
}

const sanAt = (tree: MoveNode[], san: string) => tree.find((node) => node.san === san)!;

describe("runBookImport", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM books");
    getDb().exec("DELETE FROM repertoires");
    addBook();
  });

  afterAll(() => {
    closeDb();
    rmSync(env.userData, { recursive: true, force: true });
  });

  it("reads, structures, repairs and writes a book as a repertoire, one chapter per chapter", async () => {
    const { chat, kinds } = fakeChat();
    const events: BookProgressEvent[] = [];
    await expect(
      runBookImport(BOOK, deps(chat, events), new AbortController().signal)
    ).resolves.toBe("done");

    expect(kinds()).toStrictEqual([
      "ocr",
      "ocr",
      "ocr",
      "ocr",
      "outline",
      "lines",
      "lines",
      "lines",
      "lines",
      "repair"
    ]);
    const book = store.get(BOOK)!;
    expect(book).toMatchObject({
      status: "done",
      stage: null,
      error: null,
      title: "Synthetic Openings",
      author: "A. Writer",
      color: "white"
    });
    expect(book.costUsd).toBeCloseTo(0.1);
    expect([...new Set(events.map((event) => event.stage))]).toStrictEqual([
      null,
      "ocr",
      "outline",
      "lines",
      "repair",
      "write"
    ]);
    expect(events.at(-1)).toMatchObject({ status: "done", stage: null });

    const repertoire = getRepertoire(book.repertoireId!);
    expect(repertoire).toMatchObject({ name: "Synthetic Openings", color: "white" });
    expect(repertoire.chapters.map((chapter) => chapter.title)).toStrictEqual([
      "Chapter A",
      "Chapter B"
    ]);
    expect(repertoire.decisionCount).toBeGreaterThan(0);
    const [first, second] = store.chapters(BOOK);
    expect(first).toMatchObject({ firstPageIndex: 0, lastPageIndex: 1 });
    expect(second).toMatchObject({ firstPageIndex: 2, lastPageIndex: 3 });
    expect(first.repertoireChapterId).toBe(repertoire.chapters[0].id);
    expect(first.report).toMatchObject({ lines: 3, legalLines: 3, repairedLines: 1 });

    const { tree, nodeMeta } = getChapter({
      repertoireId: repertoire.id,
      chapterId: first.repertoireChapterId!
    });
    expect(sanAt(tree, "e4").comment).toBe("[%page 1] Game: Alpha–Beta, Test Open 2000");
    expect(sanAt(tree, "Nf3")).toMatchObject({ comment: "Develops.", nags: ["$1"] });
    expect(bookPageOf(sanAt(tree, "Nc6").comment)).toBe(2);
    expect(sanAt(tree, "Bb5")).toBeDefined();
    expect(nodeMeta[sanAt(tree, "Bc4").id]).toStrictEqual({ edge: "reference" });
    expect(store.pages(BOOK)[1].lines?.lines[0]).toMatchObject({
      moves: REPAIRED_LINE,
      repairedFrom: ILLEGAL_LINE,
      repairAttempts: 1
    });
  });

  it("gives each page's lines prompt where the book is, and each chapter a fresh start", async () => {
    const { chat, requests } = fakeChat();
    await runBookImport(BOOK, deps(chat), new AbortController().signal);
    const lines = requests.filter((request) => promptKind(request) === "lines").map(userText);
    const forPage = (index: number) => lines.find((text) => text.endsWith(PAGE_TEXT[index]))!;
    expect(forPage(0)).toContain("Current game: (none yet: chapter introduction)");
    expect(forPage(0)).toContain("END OF THE PREVIOUS PAGE\n(chapter start)");
    expect(forPage(1)).toContain("Current game: Alpha - Beta, Test Open 2000");
    expect(forPage(1)).toContain("Main line so far: 1. e4 e5 2. Nf3");
    expect(forPage(1)).toContain(`END OF THE PREVIOUS PAGE\n${PAGE_TEXT[0]}`);
    expect(forPage(2)).toContain("END OF THE PREVIOUS PAGE\n(chapter start)");
    expect(forPage(3)).toContain("Main line so far: 1. d4 d5 2. c4");
    const repair = requests.find((request) => promptKind(request) === "repair")!;
    expect(JSON.stringify(repair)).toContain(
      "POSITION BEFORE IT (FEN): r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"
    );
    expect(repair.messages[0].content).toHaveLength(3);
    expect(requests.find((request) => promptKind(request) === "lines")).toMatchObject({
      model: "text/model",
      json: true,
      reasoning: "low"
    });
  });

  it("pauses when cancelled and resumes without paying again for what was read", async () => {
    const controller = new AbortController();
    const first = fakeChat();
    // The cancel lands while page 2's lines are asked for: the fake rejects as fetch would.
    first.chat.mockImplementation(cancellingAt(1, controller, first.requests));
    const events: BookProgressEvent[] = [];
    await expect(runBookImport(BOOK, deps(first.chat, events), controller.signal)).resolves.toBe(
      "paused"
    );
    expect(store.get(BOOK)).toMatchObject({ status: "paused", error: null });
    expect(events.at(-1)).toMatchObject({ status: "paused" });

    const second = fakeChat();
    await expect(
      runBookImport(BOOK, deps(second.chat), new AbortController().signal)
    ).resolves.toBe("done");
    // Pages read before the cancel aren't read again; the cancelled page is.
    expect(second.kinds().filter((kind) => kind === "ocr")).toHaveLength(0);
    expect(second.kinds().filter((kind) => kind === "outline")).toHaveLength(0);
    expect(linesFor(second.requests, 0)).toHaveLength(0);
    expect(linesFor(second.requests, 1)).toHaveLength(1);
  });

  it("retries a passing failure with backoff and stops on one that won't pass", async () => {
    const { chat } = fakeChat();
    chat.mockImplementation(failingChat(2));
    const events: BookProgressEvent[] = [];
    // One page at a time, so one request meets both failures.
    const jobDeps = { ...deps(chat, events), concurrency: { ocr: 1 } };
    await expect(runBookImport(BOOK, jobDeps, new AbortController().signal)).resolves.toBe(
      "failed"
    );
    expect(jobDeps.sleep.mock.calls.map(([ms]) => ms)).toStrictEqual([2_000, 8_000]);
    expect(store.get(BOOK)).toMatchObject({
      status: "failed",
      stage: "outline",
      error: "Out of credits."
    });
    expect(events.at(-1)).toMatchObject({ status: "failed", error: "Out of credits." });
  });

  it("asks again for an unreadable answer, then reads on without that page's lines", async () => {
    const { chat, requests } = fakeChat(linesAnswer(3, "no json"));
    await expect(runBookImport(BOOK, deps(chat), new AbortController().signal)).resolves.toBe(
      "done"
    );
    expect(linesFor(requests, 3)).toHaveLength(2);
    expect(store.pages(BOOK)[3]).toMatchObject({
      linesStatus: "failed",
      lines: { game: null, lines: [] }
    });
    expect(store.chapters(BOOK)[1].report).toMatchObject({ unreadablePages: [3], moves: 3 });
  });

  it("fails with a message when no page gave a move", async () => {
    const empty = JSON.stringify({ game: null, lines: [] });
    const { chat } = fakeChat((request) =>
      [0, 1, 2, 3].map((index) => linesAnswer(index, empty)(request)).find(Boolean)
    );
    await expect(runBookImport(BOOK, deps(chat), new AbortController().signal)).resolves.toBe(
      "failed"
    );
    expect(store.get(BOOK)).toMatchObject({
      error: "No moves could be read from this book.",
      repertoireId: null
    });
  });
});
