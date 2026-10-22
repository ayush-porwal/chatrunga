/**
 * The `books.*` IPC inputs, checked (they come from the renderer). Loaded with the book import
 * (books/index.ts), so the main bundle doesn't carry them.
 */
import {
  MAX_BOOK_PAGES,
  type AddBookPageInput,
  type BookEstimateInput,
  type CreateBookInput
} from "@chaturanga/shared/types/books";
import { PICTURE_MAX_BYTES } from "../picture-store";
import {
  asId,
  asIntegerInRange,
  asObject,
  asString,
  CONTROL_CHARS,
  fail,
  nullable
} from "./fields";

const MAX_SOURCE_NAME = 260;
const MAX_TITLE = 300;

function pageCount(value: unknown): number {
  return asIntegerInRange(value, "page count", 1, MAX_BOOK_PAGES);
}

/** A one-line text: trimmed, without control characters, not blank. */
function asLine(value: unknown, label: string, max: number): string {
  const text = asString(value, label, max).trim();
  if (!text || CONTROL_CHARS.test(text)) fail(label, "expected one line of text");
  return text;
}

export function parseBookEstimateInput(value: unknown): BookEstimateInput {
  return { pageCount: pageCount(asObject(value, "book estimate").pageCount) };
}

export function parseCreateBookInput(value: unknown): CreateBookInput {
  const input = asObject(value, "book");
  const sha256 = asString(input.sha256, "sha256", 64);
  if (!/^[0-9a-f]{64}$/.test(sha256)) fail("sha256", "expected 64 hex digits");
  return {
    sourceName: asLine(input.sourceName, "source name", MAX_SOURCE_NAME),
    pageCount: pageCount(input.pageCount),
    metadataTitle:
      nullable(input.metadataTitle, (title) => {
        const text = asString(title, "metadata title", MAX_TITLE).trim();
        return text && !CONTROL_CHARS.test(text) ? text : null;
      }) ?? null,
    sha256,
    title: nullable(input.title, (title) => asLine(title, "title", MAX_TITLE)) ?? null
  };
}

export function parseAddBookPageInput(value: unknown): AddBookPageInput {
  const input = asObject(value, "book page");
  const bytes = input.bytes;
  if (!(bytes instanceof Uint8Array)) fail("page bytes", "expected bytes");
  if (!bytes.byteLength || bytes.byteLength > PICTURE_MAX_BYTES) {
    fail("page bytes", "expected an image of at most 5 MB");
  }
  return {
    bookId: asId(input.bookId, "book id"),
    pageIndex: asIntegerInRange(input.pageIndex, "page index", 0, MAX_BOOK_PAGES - 1),
    bytes
  };
}
