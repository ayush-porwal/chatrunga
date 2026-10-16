import { afterEach, describe, expect, it, vi } from "vitest";
import type { BroadcastEvent } from "@chaturanga/shared/types/broadcast";
import { fakeFetch, fakeStream, json, type FakeStream } from "../lichess/__fixtures__/fake-lichess";
import { BroadcastService } from "./broadcast-service";

vi.mock("electron", () => ({}));

const ROUND_ID = "cBQZNLYn";
const STREAM_PATH = `GET /api/stream/broadcast/round/${ROUND_ID}.pgn`;

function pgn(gameId: string, moves: string): string {
  return `[White "A"]
[Black "B"]
[Result "*"]
[GameURL "https://lichess.org/broadcast/t/r/${ROUND_ID}/${gameId}"]

${moves} *


`;
}

/** A route opening a new fake stream per request. */
function streams() {
  const opened: FakeStream[] = [];
  return {
    opened,
    handler: (request: { signal: AbortSignal | null }) => {
      const stream = fakeStream(request.signal);
      opened.push(stream);
      return stream.response;
    }
  };
}

function setup(routes: Parameters<typeof fakeFetch>[0]) {
  const { fetch, requests } = fakeFetch(routes);
  const service = new BroadcastService({ fetch });
  const events: BroadcastEvent[] = [];
  service.on("event", (event) => events.push(event));
  return { service, events, requests };
}

/** A route Lichess refuses signed in (the token) and can't find anonymously. */
function refusedSignedIn(request: { headers: Record<string, string> }): Response {
  if (request.headers.authorization) return json({ error: "Invalid token" }, 401);
  return json({ error: "Not found" }, 404);
}

/** The games among the service's events, in order. */
function gamesOf(events: readonly BroadcastEvent[]) {
  return events.flatMap((event) => (event.type === "game" ? [event.game] : []));
}

describe("BroadcastService", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks Lichess anonymously (a saved token never goes along)", async () => {
    const { service, requests } = setup({
      "GET /api/broadcast/top": () => json({ active: [], past: { currentPageResults: [] } })
    });
    await expect(service.top()).resolves.toStrictEqual({
      active: [],
      past: [],
      nextPastPage: null
    });
    expect(requests[0].url).toBe("https://lichess.org/api/broadcast/top?page=1");
    expect(requests[0].headers.authorization).toBeUndefined();
  });

  it("goes signed in with a token that may read studies, and anonymously once it is refused", async () => {
    const { fetch, requests } = fakeFetch({
      "GET /api/broadcast/abcdefgh": refusedSignedIn,
      "GET /api/broadcast/top": () => json({ active: [], past: { currentPageResults: [] } })
    });
    const service = new BroadcastService({ fetch, getToken: async () => "lip_study" });
    await service.top();
    expect(requests[0].headers.authorization).toBe("Bearer lip_study");
    // Refused signed in: asked again anonymously (and anonymous from then on).
    await expect(service.tournament("abcdefgh")).rejects.toThrow("Not found");
    expect(requests.slice(1).map((request) => request.headers.authorization)).toStrictEqual([
      "Bearer lip_study",
      undefined
    ]);
    await service.top();
    expect(requests.at(-1)?.headers.authorization).toBeUndefined();
  });

  it("rejects with a readable message when Lichess limits requests", async () => {
    const { service } = setup({
      "GET /api/broadcast/abcdefgh": () => json({ error: "Too many requests" }, 429)
    });
    await expect(service.tournament("abcdefgh")).rejects.toThrow("Lichess is limiting requests");
  });

  it("streams a round's games once for every watcher and reconnects when it drops", async () => {
    vi.useFakeTimers();
    const rounds = streams();
    const { service, events, requests } = setup({ [STREAM_PATH]: rounds.handler });
    service.watchRound(ROUND_ID);
    await vi.advanceTimersByTimeAsync(0);
    // A game split across chunks still arrives whole.
    const text = pgn("Game0001", "1. e4 e5");
    rounds.opened[0].pushRaw(text.slice(0, 20));
    rounds.opened[0].pushRaw(text.slice(20));
    rounds.opened[0].pushRaw(pgn("Game0001", "1. e4 e5 2. Nf3"));
    await vi.advanceTimersByTimeAsync(0);
    expect(gamesOf(events).map((game) => [game.id, game.moves.length])).toStrictEqual([
      ["Game0001", 2],
      ["Game0001", 3]
    ]);

    // A second watcher shares the stream and gets the latest of each game at once.
    events.length = 0;
    service.watchRound(ROUND_ID);
    expect(rounds.opened).toHaveLength(1);
    expect(events).toMatchObject([{ type: "game", game: { id: "Game0001", lastMove: "g1f3" } }]);

    rounds.opened[0].fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(events.at(-1)).toMatchObject({ type: "connection", connected: false, retrying: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(rounds.opened).toHaveLength(2);
    expect(events.at(-1)).toStrictEqual({
      type: "connection",
      roundId: ROUND_ID,
      connected: true,
      error: null,
      retrying: false
    });

    // The stream closes only when the last watcher leaves, and nothing reconnects after.
    const streamRequest = requests.at(-1);
    service.unwatchRound(ROUND_ID);
    await vi.advanceTimersByTimeAsync(0);
    expect(streamRequest?.signal?.aborted).toBe(false);
    service.unwatchRound(ROUND_ID);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(streamRequest?.signal?.aborted).toBe(true);
    expect(rounds.opened).toHaveLength(2);
  });

  it("retries a first connection that fails, telling a watcher who joins meanwhile", async () => {
    vi.useFakeTimers();
    const rounds = streams();
    const { service, events } = setup({
      [STREAM_PATH]: vi.fn(rounds.handler).mockReturnValueOnce(json({ error: "Down" }, 503))
    });
    service.watchRound(ROUND_ID);
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toMatchObject([{ type: "connection", connected: false, retrying: true }]);

    // The watch stands while it retries: a new watcher shares it and learns of the trouble.
    events.length = 0;
    service.watchRound(ROUND_ID);
    expect(events).toMatchObject([{ type: "connection", connected: false, retrying: true }]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(rounds.opened).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "connection", connected: true });
    service.unwatchRound(ROUND_ID);
    service.unwatchRound(ROUND_ID);
  });

  it("stops, saying why, when Lichess refuses the round for good", async () => {
    vi.useFakeTimers();
    const { service, events, requests } = setup({
      [STREAM_PATH]: () => json({ error: "Not found" }, 404)
    });
    service.watchRound(ROUND_ID);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(requests).toHaveLength(1);
    expect(events).toStrictEqual([
      {
        type: "connection",
        roundId: ROUND_ID,
        connected: false,
        error: "Not found",
        retrying: false
      }
    ]);
    service.unwatchRound(ROUND_ID);
  });
});
