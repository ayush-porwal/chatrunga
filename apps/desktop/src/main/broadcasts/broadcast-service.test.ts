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
    const watching = service.watchRound(ROUND_ID);
    await vi.advanceTimersByTimeAsync(0);
    await watching;
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
    await service.watchRound(ROUND_ID);
    expect(rounds.opened).toHaveLength(1);
    expect(events).toMatchObject([{ type: "game", game: { id: "Game0001", lastMove: "g1f3" } }]);

    rounds.opened[0].fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(events.at(-1)).toMatchObject({ type: "connection", connected: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(rounds.opened).toHaveLength(2);
    expect(events.at(-1)).toStrictEqual({
      type: "connection",
      roundId: ROUND_ID,
      connected: true,
      error: null
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

  it("rejects the watch when the first connection fails", async () => {
    const { service } = setup({ [STREAM_PATH]: () => json({ error: "Not found" }, 404) });
    await expect(service.watchRound(ROUND_ID)).rejects.toThrow("Not found");
  });
});
