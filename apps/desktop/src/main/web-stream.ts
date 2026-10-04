import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

/**
 * A fetch response body as a Node stream. tsconfig.json also loads the DOM types, under which
 * `Response.body` is the DOM's ReadableStream; in main it is Node's own web stream, the type
 * `Readable.fromWeb` takes.
 */
export function readableFromBody(body: ReadableStream<Uint8Array>): Readable {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one stream class at runtime; only the DOM and Node typings differ
  return Readable.fromWeb(body as NodeReadableStream<Uint8Array>);
}
