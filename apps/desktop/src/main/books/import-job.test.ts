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
  pageLinesAnswer,
  promptKind,
  repairLineOf,
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
const { withRepertoireWriteGate } = await import("../repertoire/service-runtime");

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

/** Cancels through `controller` once the write stage starts writing. */
const abortingAtWrite = (controller: AbortController) => (event: BookProgressEvent) => {
  if (event.stage === "write" && event.total === 1 && event.done === 0) controller.abort();
};

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

  /** Page 2's lines are `moves`; a repair is answered by `repair` (the line it is asked about). */
  function chapterA(
    moves: string[],
    repair: (line: string) => string = () => JSON.stringify({ moves: REPAIRED_LINE })
  ) {
    return fakeChat((request) => {
      if (promptKind(request) === "repair") return repair(repairLineOf(request));
      return linesAnswer(1, pageLinesAnswer(...moves))(request);
    });
  }

  const repairLines = (requests: readonly BookChatRequest[]) =>
    requests.filter((request) => promptKind(request) === "repair").map(repairLineOf);

  it.each([
    ["can't read it", () => JSON.stringify({ moves: null }), undefined],
    [
      "answers a line still illegal",
      () => JSON.stringify({ moves: "1. e4 e5 2. Nf3 Nc6 3. Bz6 a6" }),
      "1. e4 e5 2. Nf3 Nc6 3. Bz5 a6"
    ]
  ])(
    "keeps a variation's legal start when the repair %s twice, and reports it",
    async (_case, answer, repairedFrom) => {
      const variation = "1. e4 e5 2. Nf3 Nc6 3. Bz5 a6";
      const { chat, requests } = chapterA(["1. e4 e5 2. Nf3 Nc6 3. Bb5", variation], answer);
      await expect(runBookImport(BOOK, deps(chat), new AbortController().signal)).resolves.toBe(
        "done"
      );
      expect(repairLines(requests)).toHaveLength(2);
      const stored = store.pages(BOOK)[1].lines?.lines[1];
      expect(stored).toMatchObject({ repairAttempts: 2 });
      expect(stored?.repairedFrom).toBe(repairedFrom);
      const [first] = store.chapters(BOOK);
      expect(first.report?.illegalLines).toStrictEqual([
        expect.objectContaining({ pageIndex: 1, printedPage: 2, label: "a" })
      ]);
      const { tree } = getChapter({
        repertoireId: store.get(BOOK)!.repertoireId!,
        chapterId: first.repertoireChapterId!
      });
      expect(tree.filter((node) => node.san === "Bb5")).toHaveLength(1);
      expect(tree.some((node) => node.san === "a6")).toBe(false);
    }
  );

  it("repairs lines sharing a misread move with one request, counted as one error", async () => {
    const copied = `${ILLEGAL_LINE} a6 4. Ba4 Nf6`;
    const { chat, requests } = chapterA([ILLEGAL_LINE, copied]);
    const events: BookProgressEvent[] = [];
    await expect(
      runBookImport(BOOK, deps(chat, events), new AbortController().signal)
    ).resolves.toBe("done");
    expect(repairLines(requests)).toStrictEqual([ILLEGAL_LINE]);
    expect(events.find((event) => event.stage === "repair")).toMatchObject({
      done: 0,
      total: 1,
      lines: 2
    });
    expect(events.filter((event) => event.stage === "repair").at(-1)).toMatchObject({
      done: 1,
      total: 1
    });
    expect(store.pages(BOOK)[1].lines?.lines[1]).toMatchObject({
      moves: "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6",
      repairedFrom: copied,
      repairAttempts: 1
    });
    expect(store.chapters(BOOK)[0].report).toMatchObject({
      legalLines: 3,
      repairedLines: 2,
      illegalLines: []
    });
  });

  it("repairs a line the shared correction didn't fix on its own", async () => {
    const copied = `${ILLEGAL_LINE} a6 4. Bz4`;
    const fixed = "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4";
    const answers: Record<string, string> = {
      [ILLEGAL_LINE]: REPAIRED_LINE,
      "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bz4": fixed
    };
    const { chat, requests } = chapterA([ILLEGAL_LINE, copied], (line) =>
      JSON.stringify({ moves: answers[line] })
    );
    await expect(runBookImport(BOOK, deps(chat), new AbortController().signal)).resolves.toBe(
      "done"
    );
    // The second request asks about the line as the shared correction left it.
    expect(repairLines(requests)).toStrictEqual([
      ILLEGAL_LINE,
      "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bz4"
    ]);
    expect(store.pages(BOOK)[1].lines?.lines[1]).toMatchObject({
      moves: fixed,
      repairedFrom: copied,
      repairAttempts: 2
    });
    expect(store.chapters(BOOK)[0].report).toMatchObject({ legalLines: 3, illegalLines: [] });
  });

  it("repairs the shallowest error first, whose correction heals a deeper line too", async () => {
    // The main line has two misreads; the variation only the deeper one (it reads 3. Bb5).
    const main = `${ILLEGAL_LINE} a6 4. Ba4 Nf6 5. Qz9`;
    const deeper = "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. Qz9 Be7";
    const { chat, requests } = chapterA([main, deeper], () =>
      JSON.stringify({ moves: "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O" })
    );
    await expect(runBookImport(BOOK, deps(chat), new AbortController().signal)).resolves.toBe(
      "done"
    );
    expect(repairLines(requests)).toStrictEqual([main]);
    expect(store.pages(BOOK)[1].lines?.lines[1]).toMatchObject({
      moves: "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7",
      repairedFrom: deeper,
      repairAttempts: 1
    });
    expect(store.chapters(BOOK)[0].report).toMatchObject({ legalLines: 3, illegalLines: [] });
  });

  it("writes nothing when cancelled while its write waits for the repertoire write gate", async () => {
    let release!: () => void;
    const held = withRepertoireWriteGate(() => new Promise<void>((resolve) => (release = resolve)));
    const controller = new AbortController();
    const { chat } = fakeChat();
    // Cancelled (or removed) once the write is under way, before its turn at the gate.
    const run = runBookImport(
      BOOK,
      { ...deps(chat), progress: abortingAtWrite(controller) },
      controller.signal
    );
    await vi.waitFor(() => expect(controller.signal.aborted).toBe(true));
    release();
    await held;
    await expect(run).resolves.toBe("paused");
    expect(store.get(BOOK)).toMatchObject({ status: "paused", repertoireId: null });
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM repertoires").get()?.n).toBe(0);
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
