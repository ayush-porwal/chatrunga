/**
 * The book import wired to the app (book-service.ts): rows on the app's database, page images in
 * `<userData>/books`, OpenRouter with the key from Settings (it never leaves main), the repertoire
 * writer, and progress on `books:progress`. Loaded on the first `books.*` request (register.ts),
 * so the main bundle doesn't carry it; IPC inputs are checked here.
 */
import { app } from "electron";
import { join } from "node:path";
import { getOpenRouterConfigStore } from "../commentary/openrouter-config";
import { getDb } from "../db";
import { allowImageFolder } from "../image-access";
import { broadcast } from "../ipc/broadcast";
import { asId } from "../ipc/fields";
import {
  parseAddBookPageInput,
  parseBookEstimateInput,
  parseCreateBookInput
} from "../ipc/validate-books";
import { errorMessage, logger } from "../logger";
import { writeBookRepertoire } from "./book-repertoire";
import { createBookService, type BookService } from "./book-service";
import { createBookStore } from "./book-store";
import { BookImportError } from "./import-job";
import { modelPrices } from "./model-prices";
import { openRouterChat } from "./openrouter-chat";
import { bookPageFiles } from "./page-files";

const NO_KEY =
  "Add an OpenRouter API key in Settings → AI to import a book (reading its pages uses it).";
const UNREADABLE_KEY =
  "Your saved OpenRouter key couldn't be read on this computer. Add it again in Settings → AI.";

let service: BookService | null = null;

function books(): BookService {
  if (service) return service;
  const warn = (message: string, error: unknown) =>
    logger.warn("books", `${message}:`, errorMessage(error));
  const config = getOpenRouterConfigStore();
  const files = bookPageFiles(join(app.getPath("userData"), "books"), warn);
  service = createBookService({
    store: createBookStore(getDb),
    files,
    chat: async () => {
      const [summary, apiKey] = await Promise.all([config.get(), config.getApiKey()]);
      if (!apiKey) throw new BookImportError(summary.hasApiKey ? UNREADABLE_KEY : NO_KEY);
      return openRouterChat({ apiKey });
    },
    models: async () => {
      const summary = await config.get();
      return { ocr: summary.bookOcrModel, structure: summary.model };
    },
    prices: modelPrices(),
    writeRepertoire: writeBookRepertoire,
    progress: (event) => broadcast("books:progress", event),
    allowFolder: allowImageFolder,
    imageSrc: (path) => `chaturanga-image://local/${encodeURIComponent(path)}`,
    log: (message, error) => logger.error("books", `${message}:`, error)
  });
  service.recoverInterrupted();
  sweep(service);
  return service;
}

function sweep(target: BookService): void {
  target.sweep().then(
    (removed) => {
      if (removed) logger.info("books", `deleted the pages of ${removed} removed book(s)`);
    },
    (error: unknown) => logger.warn("books", "sweeping book pages failed:", errorMessage(error))
  );
}

/** Deletes page images of books that are gone (a deleted repertoire takes its book along). */
export function sweepBookFiles(): void {
  // Loading the service sweeps once already.
  if (service) sweep(service);
  else books();
}

export const estimateBook = (input: unknown) => books().estimate(parseBookEstimateInput(input));
export const createBook = (input: unknown) => books().create(parseCreateBookInput(input));
export const addBookPage = (input: unknown) => books().addPage(parseAddBookPageInput(input));
export const startBook = (bookId: unknown) => books().start(asId(bookId, "book id"));
export const resumeBook = (bookId: unknown) => books().resume(asId(bookId, "book id"));
export const cancelBook = (bookId: unknown) => books().cancel(asId(bookId, "book id"));
export const getBook = (bookId: unknown) => books().get(asId(bookId, "book id"));
export const listBooks = () => books().list();
export const removeBook = (bookId: unknown) => books().remove(asId(bookId, "book id"));
export const bookPages = (repertoireId: unknown) =>
  books().pages(asId(repertoireId, "repertoire id"));
