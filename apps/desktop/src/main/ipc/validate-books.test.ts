import { describe, expect, it } from "vitest";
import {
  parseAddBookPageInput,
  parseBookEstimateInput,
  parseCreateBookInput
} from "./validate-books";

const SHA = "f".repeat(64);

describe("books IPC inputs", () => {
  it("accepts well-formed inputs, trimmed", () => {
    expect(parseBookEstimateInput({ pageCount: 352 })).toStrictEqual({ pageCount: 352 });
    expect(
      parseCreateBookInput({
        sourceName: " book.pdf ",
        pageCount: 3,
        metadataTitle: "  ",
        sha256: SHA
      })
    ).toStrictEqual({ sourceName: "book.pdf", pageCount: 3, metadataTitle: null, sha256: SHA });
    const bytes = new Uint8Array([1, 2, 3]);
    expect(parseAddBookPageInput({ bookId: "b", pageIndex: 0, bytes })).toStrictEqual({
      bookId: "b",
      pageIndex: 0,
      bytes
    });
  });

  it.each([
    [() => parseBookEstimateInput({ pageCount: 0 }), /page count/],
    [() => parseBookEstimateInput({ pageCount: 2.5 }), /page count/],
    [() => parseCreateBookInput({ sourceName: "a\nb", pageCount: 1, sha256: SHA }), /source name/],
    [() => parseCreateBookInput({ sourceName: "a", pageCount: 1, sha256: "xyz" }), /sha256/],
    [() => parseAddBookPageInput({ bookId: "b", pageIndex: 0, bytes: [1, 2] }), /page bytes/],
    [
      () => parseAddBookPageInput({ bookId: "b", pageIndex: 0, bytes: new Uint8Array() }),
      /page bytes/
    ],
    [
      () => parseAddBookPageInput({ bookId: "b", pageIndex: -1, bytes: new Uint8Array([1]) }),
      /page index/
    ]
  ])("refuses a malformed input (%#)", (parse, message) => {
    expect(parse).toThrow(message);
  });
});
