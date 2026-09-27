import { describe, expect, it } from "vitest";
import { readNdjson } from "./ndjson";

function bodyFrom(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks)
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      controller.close();
    }
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const values: unknown[] = [];
  for await (const value of readNdjson(body)) values.push(value);
  return values;
}

describe("readNdjson", () => {
  it("joins lines split across chunks and skips keep-alive newlines", async () => {
    const values = await collect(
      bodyFrom(['{"type":"game', 'Start","id":1}\n', "\n", '\n{"a"', ':2}\n{"b":3}\n\n'])
    );
    expect(values).toEqual([{ type: "gameStart", id: 1 }, { a: 2 }, { b: 3 }]);
  });

  it("parses a final line without a trailing newline", async () => {
    expect(await collect(bodyFrom(['{"a":1}\n{"b":', "2}"]))).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("decodes a multi-byte character split between chunks", async () => {
    const bytes = new TextEncoder().encode('{"name":"Élodie"}\n');
    const split = bytes.indexOf(0xc3) + 1;
    expect(await collect(bodyFrom([bytes.slice(0, split), bytes.slice(split)]))).toEqual([
      { name: "Élodie" }
    ]);
  });

  it("skips malformed lines and handles CRLF", async () => {
    expect(await collect(bodyFrom(['not json\r\n{"ok":true}\r\n']))).toEqual([{ ok: true }]);
  });

  it("reports every chunk, keep-alives included", async () => {
    let chunks = 0;
    const values: unknown[] = [];
    for await (const value of readNdjson(
      bodyFrom(["\n", "\n", '{"a":1}\n']),
      () => (chunks += 1)
    )) {
      values.push(value);
    }
    expect(chunks).toBe(3);
    expect(values).toEqual([{ a: 1 }]);
  });

  it("releases the stream when the consumer stops early", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":1}\n{"b":2}\n'));
      },
      cancel() {
        cancelled = true;
      }
    });
    for await (const value of readNdjson(body)) {
      expect(value).toEqual({ a: 1 });
      break;
    }
    expect(cancelled).toBe(true);
  });
});
