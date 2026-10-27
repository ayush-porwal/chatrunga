import { describe, expect, it, vi } from "vitest";
import { BookChatError, openRouterChat, type BookChatRequest } from "./openrouter-chat";

const request = (overrides: Partial<BookChatRequest> = {}): BookChatRequest => ({
  model: "vision/model",
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "Read this page." },
        { type: "image_url", image_url: { url: "data:image/webp;base64,AAAA" } }
      ]
    }
  ],
  signal: new AbortController().signal,
  ...overrides
});

const answer = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("openRouterChat", () => {
  it("sends text and image parts and JSON mode, uncapped, and reads the answer and its cost", async () => {
    const fetchImpl = answer({
      choices: [{ message: { content: ' {"lines": []} ' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0042 }
    });
    const chat = openRouterChat({ apiKey: "test-key", fetchImpl });
    await expect(chat(request({ json: true }))).resolves.toStrictEqual({
      text: '{"lines": []}',
      costUsd: 0.0042
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-key" });
    // No token limit, temperature or reasoning effort: the model thinks as long as it needs to.
    expect(JSON.parse(init.body as string)).toStrictEqual({
      model: "vision/model",
      messages: request().messages,
      usage: { include: true },
      response_format: { type: "json_object" }
    });
  });

  it.each([
    [401, "rejected the API key", false],
    [402, "out of credits", false],
    [404, "doesn't know this model", false],
    [429, "rate limiting", true],
    [503, "returned an error (503)", true]
  ])("maps HTTP %i to a message to show (retryable: %s)", async (status, message, retryable) => {
    const chat = openRouterChat({
      apiKey: "k",
      fetchImpl: answer({ error: "secret body" }, status)
    });
    const failure = await chat(request()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BookChatError);
    expect(failure).toMatchObject({ retryable });
    expect((failure as Error).message).toContain(message);
  });

  it("treats an empty answer, an unreachable server and the time limit as worth retrying", async () => {
    const empty = openRouterChat({ apiKey: "k", fetchImpl: answer({ choices: [] }) });
    await expect(empty(request())).rejects.toMatchObject({ retryable: true });
    const offline = openRouterChat({
      apiKey: "k",
      fetchImpl: vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    });
    await expect(offline(request())).rejects.toThrow("couldn't be reached");
    const slow = openRouterChat({
      apiKey: "k",
      timeoutMs: 5,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")))
        )
    });
    await expect(slow(request())).rejects.toThrow("took too long");
  });

  it("says the model ran out of room, not worth retrying, when it thought without answering", async () => {
    const fetchImpl = answer({
      choices: [{ finish_reason: "length", message: { content: null } }],
      usage: {
        completion_tokens: 128_000,
        completion_tokens_details: { reasoning_tokens: 128_000 }
      }
    });
    const chat = openRouterChat({ apiKey: "k", fetchImpl });
    const failure = await chat(request()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BookChatError);
    expect(failure).toMatchObject({ retryable: false });
    expect((failure as Error).message).toContain("ran out of room before answering");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("passes the caller's cancel through as it is, before and during a request", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const fetchImpl = answer({});
    const chat = openRouterChat({ apiKey: "k", fetchImpl });
    await expect(chat(request({ signal: controller.signal }))).rejects.toThrow("cancelled");
    expect(fetchImpl).not.toHaveBeenCalled();

    const during = new AbortController();
    const hanging = openRouterChat({
      apiKey: "k",
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          during.abort(new Error("cancelled mid-request"));
        })
    });
    await expect(hanging(request({ signal: during.signal }))).rejects.toThrow(
      "cancelled mid-request"
    );
  });
});
