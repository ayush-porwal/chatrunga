import { describe, expect, it, vi } from "vitest";
import { fakeFetch, fakeStream, flush, json } from "./__fixtures__/fake-lichess";
import {
  LichessClient,
  LichessHttpError,
  lichessErrorMessage,
  NOT_CONNECTED_ERROR,
  RATE_LIMITED_ERROR,
  TOKEN_REJECTED_ERROR
} from "./http";

describe("lichessErrorMessage", () => {
  it("uses Lichess's own error text", () => {
    expect(lichessErrorMessage(400, '{"error":"Not your turn, or game already over"}')).toBe(
      "Not your turn, or game already over"
    );
    expect(lichessErrorMessage(400, '{"error":{"clock.limit":["Must be at least 480"]}}')).toBe(
      "Must be at least 480"
    );
    expect(
      lichessErrorMessage(400, '{"error":"invalid_grant","error_description":"code expired"}')
    ).toBe("code expired");
  });

  it("explains rate limits, rejected tokens and bare failures", () => {
    expect(lichessErrorMessage(429, '{"error":"Too many requests"}')).toBe(RATE_LIMITED_ERROR);
    expect(lichessErrorMessage(401, "")).toBe(TOKEN_REJECTED_ERROR);
    expect(lichessErrorMessage(404, "<html>")).toMatch(/couldn't find/);
    expect(lichessErrorMessage(503, "")).toMatch(/trouble.*503/);
    expect(lichessErrorMessage(418, "")).toMatch(/418/);
  });
});

describe("LichessClient", () => {
  it("sends the bearer token and form bodies", async () => {
    const { fetch, requests } = fakeFetch({ "POST /api/board/seek": () => json({ ok: true }) });
    const client = new LichessClient({ fetch, getToken: async () => "test-token" });
    await client.send("/api/board/seek", {
      form: { rated: true, time: 10, ratingRange: undefined }
    });
    expect(requests[0]).toMatchObject({
      url: "https://lichess.org/api/board/seek",
      method: "POST",
      body: "rated=true&time=10"
    });
    expect(requests[0]!.headers).toMatchObject({
      authorization: "Bearer test-token",
      "content-type": "application/x-www-form-urlencoded"
    });
  });

  it("refuses to call an authenticated endpoint without a token", async () => {
    const { fetch, requests } = fakeFetch({});
    const client = new LichessClient({ fetch, getToken: async () => null });
    await expect(client.request("/api/account")).rejects.toThrow(NOT_CONNECTED_ERROR);
    expect(requests).toHaveLength(0);
  });

  it("reports a 401 to the saved token as rejected, but not for an explicit token", async () => {
    const { fetch } = fakeFetch({
      "GET /api/account": () => json({ error: "No such token" }, 401)
    });
    const onTokenRejected = vi.fn();
    const client = new LichessClient({ fetch, getToken: async () => "saved", onTokenRejected });
    await expect(client.request("/api/account", { token: "fresh" })).rejects.toThrow(
      TOKEN_REJECTED_ERROR
    );
    expect(onTokenRejected).not.toHaveBeenCalled();
    const error = await client.request("/api/account").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LichessHttpError);
    expect((error as LichessHttpError).status).toBe(401);
    expect(onTokenRejected).toHaveBeenCalledTimes(1);
  });

  it("turns network failures into a readable error", async () => {
    const client = new LichessClient({
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
      getToken: async () => "token"
    });
    await expect(client.request("/api/account")).rejects.toMatchObject({
      status: 0,
      message: /Couldn't reach Lichess/
    });
  });

  it("streams NDJSON lines and returns when the server closes", async () => {
    const stream = fakeStream();
    const { fetch, requests } = fakeFetch({ "GET /api/stream/event": () => stream.response });
    const client = new LichessClient({ fetch, getToken: async () => "token" });
    const lines: unknown[] = [];
    const onOpen = vi.fn();
    const done = client.stream("/api/stream/event", { onOpen }, (line) => lines.push(line));
    await flush();
    expect(onOpen).toHaveBeenCalledTimes(1);
    stream.push({ type: "gameStart" });
    stream.pushRaw("\n");
    stream.close();
    await done;
    expect(lines).toEqual([{ type: "gameStart" }]);
    expect(requests[0]!.headers.accept).toBe("application/x-ndjson");
  });

  it("treats a silent stream as dropped", async () => {
    vi.useFakeTimers();
    try {
      let stream: ReturnType<typeof fakeStream> | null = null;
      const { fetch } = fakeFetch({
        "GET /api/stream/event": (request) => (stream = fakeStream(request.signal)).response
      });
      const client = new LichessClient({ fetch, getToken: async () => "token" });
      const done = client.stream("/api/stream/event", { idleTimeoutMs: 30_000 }, () => undefined);
      const outcome = done.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(20_000);
      stream!.pushRaw("\n"); // a keep-alive resets the watchdog
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await Promise.race([outcome, Promise.resolve("pending")])).toBe("pending");
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await outcome).toMatchObject({ message: /went silent/ });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects with AbortError when the caller aborts", async () => {
    const { fetch } = fakeFetch({
      "GET /api/stream/event": (request) => fakeStream(request.signal).response
    });
    const client = new LichessClient({ fetch, getToken: async () => "token" });
    const controller = new AbortController();
    const done = client.stream(
      "/api/stream/event",
      { signal: controller.signal, idleTimeoutMs: 30_000 },
      () => undefined
    );
    await flush();
    controller.abort();
    await expect(done).rejects.toMatchObject({ name: "AbortError" });
  });
});
