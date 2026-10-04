/** Test doubles for lichess.org: a scripted `fetch` and streaming NDJSON responses. */

export type FakeStream = {
  response: Response;
  push(value: unknown): void;
  pushRaw(text: string): void;
  close(): void;
  fail(error?: Error): void;
};

/** A streaming body that errors with AbortError when `signal` aborts, as a real fetch does. */
export function fakeStream(signal?: AbortSignal | null, status = 200): FakeStream {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    }
  });
  const finish = (action: () => void) => {
    if (closed) return;
    closed = true;
    action();
  };
  signal?.addEventListener("abort", () =>
    finish(() => controller.error(new DOMException("This operation was aborted", "AbortError")))
  );
  return {
    response: new Response(body, { status, headers: { "Content-Type": "application/x-ndjson" } }),
    push: (value) => {
      if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
    },
    pushRaw: (text) => {
      if (!closed) controller.enqueue(encoder.encode(text));
    },
    close: () => finish(() => controller.close()),
    fail: (error = new TypeError("terminated")) => finish(() => controller.error(error))
  };
}

export type RecordedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal | null;
};

type Handler = (request: RecordedRequest) => Response | Promise<Response>;

/**
 * `fetch` answering by `METHOD path` (path without the query string). Unmatched requests get a
 * 404. Every request is recorded.
 */
export function fakeFetch(routes: Record<string, Handler>) {
  const requests: RecordedRequest[] = [];
  const fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    if (init.signal?.aborted) throw new DOMException("This operation was aborted", "AbortError");
    const url = new URL(input);
    const request: RecordedRequest = {
      url: input,
      method: init.method ?? "GET",
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      // Lichess requests send form bodies (URLSearchParams) or none.
      body: init.body instanceof URLSearchParams ? init.body.toString() : "",
      signal: init.signal ?? null
    };
    requests.push(request);
    const handler = routes[`${request.method} ${url.pathname}`];
    if (!handler) return json({ error: "Not found" }, 404);
    return handler(request);
  };
  return { fetch, requests };
}

export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

/** Lets pending promise callbacks and stream reads run. */
export async function flush(times = 5): Promise<void> {
  for (let index = 0; index < times; index += 1)
    await new Promise((resolve) => setTimeout(resolve, 0));
}
