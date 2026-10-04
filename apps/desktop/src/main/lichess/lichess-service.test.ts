import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LichessAccount, LichessEvent } from "@chaturanga/shared/types/lichess";
import { fakeFetch, fakeStream, flush, json, type FakeStream } from "./__fixtures__/fake-lichess";
import { LichessAccountStore } from "./account-store";
import { LichessService, reconnectDelay, type LichessGameStore } from "./lichess-service";
import { LichessHttpError } from "./http";

vi.mock("electron", () => ({ app: { getPath: () => tmpdir() } }));

const ACCOUNT: LichessAccount = {
  id: "kenneth",
  username: "Kenneth",
  title: null,
  perfs: {},
  connectedAt: 1000,
  lastSyncAt: null
};

const GAME_FULL = {
  type: "gameFull",
  id: "abcd1234",
  speed: "rapid",
  rated: true,
  createdAt: 1,
  white: { id: "kenneth", name: "Kenneth", rating: 1500 },
  black: { id: "salma", name: "Salma", rating: 1510 },
  initialFen: "startpos",
  clock: { initial: 600000, increment: 0 },
  state: {
    type: "gameState",
    moves: "",
    wtime: 600000,
    btime: 600000,
    winc: 0,
    binc: 0,
    status: "started"
  }
};

const temporaryDirectories: string[] = [];
const services: LichessService[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const service of services.splice(0)) service.shutdown();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

const storage = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`cipher:${value}`),
  decryptString: (value: Buffer) => value.toString().replace(/^cipher:/, "")
};

function memoryGames(): LichessGameStore & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    findIdBySite: () => null,
    saveImported: () => undefined,
    removeBySource: (source) => {
      removed.push(source);
      return 0;
    }
  };
}

async function setup(
  routes: Parameters<typeof fakeFetch>[0],
  options: { connected?: boolean; openExternal?: (url: string) => Promise<void> } = {}
) {
  const directory = await mkdtemp(join(tmpdir(), "chaturanga-lichess-service-"));
  temporaryDirectories.push(directory);
  const store = new LichessAccountStore(join(directory, "lichess-account.json"), storage);
  if (options.connected !== false) await store.save(ACCOUNT, "lip_saved-token");
  const { fetch, requests } = fakeFetch(routes);
  const games = memoryGames();
  const service = new LichessService({
    store,
    games,
    fetch,
    openExternal: options.openExternal ?? (async () => undefined)
  });
  services.push(service);
  const events: LichessEvent[] = [];
  service.on("event", (event) => events.push(event));
  return { service, store, requests, events, games };
}

/** Routes a streaming endpoint to fresh fake streams, one per request. */
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

describe("reconnectDelay", () => {
  it("backs off exponentially up to 30 s, and waits a minute after a rate limit", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((attempt) => reconnectDelay(attempt, null))).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000
    ]);
    expect(reconnectDelay(0, new LichessHttpError("slow down", 429))).toBe(60_000);
  });
});

describe("LichessService", () => {
  it("starts the event stream on the first status() and forwards its events", async () => {
    const events = streams();
    const {
      service,
      events: emitted,
      requests
    } = await setup({ "GET /api/stream/event": events.handler });
    expect(await service.status()).toEqual({
      account: ACCOUNT,
      connecting: false,
      tokenRejected: false
    });
    await flush();
    await service.status();
    await vi.waitFor(() => expect(events.opened).toHaveLength(1));
    expect(requests[0]!.headers.authorization).toBe("Bearer lip_saved-token");
    events.opened[0]!.push({ type: "gameStart", game: { gameId: "abcd1234" } });
    events.opened[0]!.push({ type: "gameFinish", game: { gameId: "abcd1234" } });
    await vi.waitFor(() => expect(emitted).toEqual([{ type: "gameStart", gameId: "abcd1234" }]));
  });

  it("reconnects the event stream with backoff after a drop", async () => {
    const events = streams();
    const { service } = await setup({ "GET /api/stream/event": events.handler });
    await service.status();
    await vi.waitFor(() => expect(events.opened).toHaveLength(1));
    vi.useFakeTimers();
    events.opened[0]!.fail();
    await vi.advanceTimersByTimeAsync(500);
    expect(events.opened).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(events.opened).toHaveLength(2);
    service.shutdown();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(events.opened).toHaveLength(2);
  });

  it("marks the token rejected on a 401 and says so", async () => {
    const { service, events, store } = await setup({
      "GET /api/stream/event": () => json({ error: "No such token" }, 401),
      "GET /api/account/playing": () => json({ error: "No such token" }, 401)
    });
    await expect(service.ongoingGames()).rejects.toThrow(/Reconnect/);
    await vi.waitFor(async () =>
      expect(await store.status()).toEqual({ account: ACCOUNT, tokenRejected: true })
    );
    // The status event follows its own read of the store: wait for it too.
    await vi.waitFor(() =>
      expect(events).toContainEqual({
        type: "status",
        status: { account: ACCOUNT, connecting: false, tokenRejected: true }
      })
    );
  });

  it("rejects a blitz seek without asking Lichess", async () => {
    const { service, requests } = await setup({});
    await expect(
      service.seek({ minutes: 3, incrementSec: 2, rated: true, ratingRange: null })
    ).rejects.toThrow(/Rapid or slower/);
    expect(requests).toHaveLength(0);
  });

  it("keeps a seek open until cancelled, then closes the request", async () => {
    const seeks = streams();
    const { service, events, requests } = await setup({
      "GET /api/stream/event": streams().handler,
      "POST /api/board/seek": seeks.handler
    });
    await service.seek({ minutes: 10, incrementSec: 5, rated: false, ratingRange: [1400, 1800] });
    const seekRequest = requests.find((request) => request.url.endsWith("/api/board/seek"))!;
    expect(Object.fromEntries(new URLSearchParams(seekRequest.body))).toEqual({
      rated: "false",
      time: "10",
      increment: "5",
      variant: "standard",
      color: "random",
      ratingRange: "1400-1800"
    });
    // The event stream is opened first, so an instant pairing isn't missed.
    expect(requests[0]!.url).toContain("/api/stream/event");
    expect(events).toContainEqual({ type: "seek", searching: true, error: null });

    service.cancelSeek();
    await vi.waitFor(() =>
      expect(events.filter((event) => event.type === "seek")).toEqual([
        { type: "seek", searching: true, error: null },
        { type: "seek", searching: false, error: null }
      ])
    );
    expect(seekRequest.signal!.aborted).toBe(true);
  });

  it("reports a seek Lichess ends (paired or expired)", async () => {
    const seeks = streams();
    const { service, events } = await setup({
      "GET /api/stream/event": streams().handler,
      "POST /api/board/seek": seeks.handler
    });
    await service.seek({ minutes: 15, incrementSec: 10, rated: true, ratingRange: null });
    seeks.opened[0]!.close();
    await vi.waitFor(() =>
      expect(events.at(-1)).toEqual({ type: "seek", searching: false, error: null })
    );
  });

  it("streams a game once for every watcher and reconnects with a fresh gameFull", async () => {
    vi.useFakeTimers();
    const games = streams();
    const { service, events } = await setup({
      "GET /api/board/game/stream/abcd1234": games.handler
    });
    const watching = service.watchGame("abcd1234");
    await vi.advanceTimersByTimeAsync(0);
    await watching;
    games.opened[0]!.push(GAME_FULL);
    games.opened[0]!.push({
      type: "gameState",
      moves: "e2e4",
      wtime: 599000,
      btime: 600000,
      winc: 0,
      binc: 0,
      status: "started",
      bdraw: true
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(events.map((event) => event.type)).toEqual(["gameFull", "gameState"]);
    expect(events[1]).toMatchObject({
      gameId: "abcd1234",
      state: { moves: ["e2e4"], drawOffer: "black" }
    });

    // A second watcher shares the stream and gets the latest position at once.
    await service.watchGame("abcd1234");
    expect(games.opened).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "gameFull", game: { state: { moves: ["e2e4"] } } });

    games.opened[0]!.fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(events.at(-1)).toEqual({ type: "gameConnection", gameId: "abcd1234", connected: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(games.opened).toHaveLength(2);
    expect(events.at(-1)).toEqual({ type: "gameConnection", gameId: "abcd1234", connected: true });
    games.opened[1]!.push(GAME_FULL);
    await vi.advanceTimersByTimeAsync(0);
    expect(events.at(-1)).toMatchObject({ type: "gameFull" });

    // The game ends: Lichess closes the stream and nothing reconnects.
    games.opened[1]!.push({
      type: "gameState",
      moves: "e2e4",
      wtime: 1,
      btime: 1,
      winc: 0,
      binc: 0,
      status: "resign",
      winner: "white"
    });
    games.opened[1]!.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(games.opened).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({
      type: "gameState",
      state: { status: "resign", winner: "white" }
    });
  });

  it("stops a game stream when its last watcher leaves", async () => {
    const games = streams();
    const { service } = await setup({ "GET /api/board/game/stream/abcd1234": games.handler });
    await service.watchGame("abcd1234");
    await service.watchGame("abcd1234");
    service.unwatchGame("abcd1234");
    await flush();
    expect(games.opened).toHaveLength(1);
    service.unwatchGame("abcd1234");
    await flush();
    await service.watchGame("abcd1234");
    expect(games.opened).toHaveLength(2);
  });

  it("rejects watchGame when the game can't be streamed", async () => {
    const { service } = await setup({});
    await expect(service.watchGame("abcd1234")).rejects.toThrow(/Not found/);
  });

  it("sends game actions to the Board API", async () => {
    const ok = () => json({ ok: true });
    const { service, requests } = await setup({
      "POST /api/board/game/abcd1234/move/e2e4": ok,
      "POST /api/board/game/abcd1234/draw/yes": ok,
      "POST /api/board/game/abcd1234/draw/no": ok,
      "POST /api/board/game/abcd1234/resign": ok,
      "POST /api/board/game/abcd1234/abort": ok
    });
    await service.move("abcd1234", "e2e4");
    await service.offerDraw("abcd1234");
    await service.declineDraw("abcd1234");
    await service.resign("abcd1234");
    await service.abort("abcd1234");
    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual(
      [
        "POST /api/board/game/abcd1234/move/e2e4",
        "POST /api/board/game/abcd1234/draw/yes",
        "POST /api/board/game/abcd1234/draw/no",
        "POST /api/board/game/abcd1234/resign",
        "POST /api/board/game/abcd1234/abort"
      ]
    );
  });

  it("lists challenges from your side and ongoing games", async () => {
    const challenge = {
      id: "C8fNpisS",
      challenger: { id: "bobby", name: "Bobby", rating: 1657 },
      destUser: { id: "kenneth", name: "Kenneth", rating: 1079 },
      rated: false,
      speed: "rapid",
      timeControl: { type: "clock", limit: 900, increment: 10 },
      color: "random",
      direction: "in"
    };
    const { service } = await setup({
      "GET /api/challenge": () => json({ in: [challenge, { broken: true }], out: [] }),
      "GET /api/account/playing": () =>
        json({ nowPlaying: [{ gameId: "abcd1234", fullId: "abcd1234wxyz" }] })
    });
    expect(await service.challenges()).toEqual([
      {
        id: "C8fNpisS",
        direction: "in",
        opponent: { id: "bobby", name: "Bobby", rating: 1657, title: null, aiLevel: null },
        rated: false,
        speed: "rapid",
        timeControl: { minutes: 15, incrementSec: 10 },
        yourColor: "random"
      }
    ]);
    expect(await service.ongoingGames()).toEqual(["abcd1234"]);
  });

  it("keeps an outgoing challenge alive and reports how it ended", async () => {
    const challenges = streams();
    const { service, events, requests } = await setup({
      "GET /api/stream/event": streams().handler,
      "POST /api/challenge/Salma": challenges.handler
    });
    const pending = service.challenge({
      username: "Salma",
      minutes: 10,
      incrementSec: 0,
      rated: true,
      color: "white"
    });
    await vi.waitFor(() => expect(challenges.opened).toHaveLength(1));
    challenges.opened[0]!.push({
      id: "chal1234",
      challenger: { id: "kenneth", name: "Kenneth" },
      destUser: { id: "salma", name: "Salma", rating: 1500 },
      rated: true,
      speed: "rapid",
      timeControl: { type: "clock", limit: 600, increment: 0 },
      color: "white"
    });
    expect(await pending).toMatchObject({
      id: "chal1234",
      direction: "out",
      yourColor: "white",
      opponent: { id: "salma" }
    });
    const request = requests.find((item) => item.url.endsWith("/api/challenge/Salma"))!;
    expect(Object.fromEntries(new URLSearchParams(request.body))).toEqual({
      rated: "true",
      "clock.limit": "600",
      "clock.increment": "0",
      color: "white",
      variant: "standard",
      keepAliveStream: "true"
    });
    challenges.opened[0]!.push({ done: "declined" });
    challenges.opened[0]!.close();
    await vi.waitFor(() =>
      expect(events.filter((event) => event.type === "challengeGone")).toEqual([
        { type: "challengeGone", challengeId: "chal1234", reason: "declined" }
      ])
    );
  });

  it("reports a challenge gone even when cancelling it fails", async () => {
    const { service, events } = await setup({
      "POST /api/challenge/chal1234/cancel": () => json({ error: "Server error" }, 500)
    });
    await expect(service.cancelChallenge("chal1234")).rejects.toThrow(/Server error/);
    expect(events).toContainEqual({
      type: "challengeGone",
      challengeId: "chal1234",
      reason: "canceled"
    });
  });

  it("signs in through the browser and saves the account", async () => {
    const { service, store, events } = await setup(
      {
        "POST /api/token": () =>
          json({ token_type: "Bearer", access_token: "lip_fresh-token", expires_in: 1 }),
        "GET /api/account": (request) =>
          request.headers.authorization === "Bearer lip_fresh-token"
            ? json({
                id: "salma",
                username: "Salma",
                perfs: { rapid: { rating: 1600, games: 4, rd: 80, prog: 0 } }
              })
            : json({ error: "No such token" }, 401),
        "GET /api/stream/event": streams().handler
      },
      {
        connected: false,
        openExternal: async (url) => {
          // The user approves on lichess.org; the browser follows the redirect.
          const params = new URL(url).searchParams;
          const redirect = new URL(params.get("redirect_uri")!);
          redirect.hostname = "127.0.0.1";
          redirect.searchParams.set("code", "approved-code");
          redirect.searchParams.set("state", params.get("state")!);
          setTimeout(() => void fetch(redirect).then((response) => response.text()), 0);
        }
      }
    );
    const status = await service.connect();
    expect(status).toMatchObject({
      connecting: false,
      tokenRejected: false,
      account: { id: "salma", username: "Salma" }
    });
    expect(status.account!.perfs).toEqual({
      rapid: { rating: 1600, games: 4, provisional: false }
    });
    expect(await store.getToken()).toBe("lip_fresh-token");
    const statuses = () => events.filter((event) => event.type === "status");
    expect(statuses()[0]).toMatchObject({ status: { connecting: true, account: null } });
    // Status events read the stored status first, so the last one can land just after connect().
    await vi.waitFor(() =>
      expect(statuses().at(-1)).toMatchObject({
        status: { connecting: false, account: { id: "salma" } }
      })
    );
  });

  it("resolves connect() without an account when cancelled", async () => {
    const { service } = await setup({}, { connected: false });
    const connecting = service.connect();
    await flush();
    service.cancelConnect();
    expect(await connecting).toEqual({ account: null, connecting: false, tokenRejected: false });
  });

  it("revokes the token on disconnect and removes imported games when asked", async () => {
    const { service, store, requests, games } = await setup({
      "DELETE /api/token": () => new Response(null, { status: 204 })
    });
    expect(await service.disconnect({ removeGames: true })).toEqual({
      account: null,
      connecting: false,
      tokenRejected: false
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: "DELETE", url: "https://lichess.org/api/token" });
    expect(requests[0]!.headers.authorization).toBe("Bearer lip_saved-token");
    expect(await store.status()).toEqual({ account: null, tokenRejected: false });
    expect(games.removed).toEqual(["lichess"]);
  });

  it("forgets the account even when the revoke fails", async () => {
    const { service, store, games } = await setup({
      "DELETE /api/token": () => json({ error: "down" }, 503)
    });
    await service.disconnect({ removeGames: false });
    expect(await store.status()).toEqual({ account: null, tokenRejected: false });
    expect(games.removed).toEqual([]);
  });

  it("runs one import at a time and records its progress", async () => {
    const exports = streams();
    const { service, store, events, requests } = await setup({
      "GET /api/games/user/Kenneth": exports.handler
    });
    const first = service.syncGames();
    const second = service.syncGames();
    expect(second).toBe(first);
    await vi.waitFor(() => expect(exports.opened).toHaveLength(1));
    expect(requests).toHaveLength(1);
    exports.opened[0]!.push({ id: "g1", variant: "standard", lastMoveAt: 7000, pgn: "1. e4 e5 *" });
    exports.opened[0]!.close();
    expect(await first).toEqual({ imported: 1, skipped: 0 });
    expect(await store.syncSince()).toBe(7001);
    expect((await store.status()).account!.lastSyncAt).toEqual(expect.any(Number));
    expect(events.filter((event) => event.type === "sync").at(-1)).toEqual({
      type: "sync",
      running: false,
      imported: 1,
      error: null
    });
  });

  it("reads the account's ratings again and keeps them with the account", async () => {
    const { service, store, events } = await setup({
      "GET /api/account": () =>
        json({
          id: "kenneth",
          username: "Kenneth",
          perfs: {
            blitz: { rating: 1720, games: 300, prov: false },
            rapid: { rating: 1810, games: 4, prov: true }
          }
        })
    });
    const account = await service.refreshAccount();
    expect(account?.perfs).toEqual({
      blitz: { rating: 1720, games: 300, provisional: false },
      rapid: { rating: 1810, games: 4, provisional: true }
    });
    // The rest of the account is as it was connected.
    expect((await store.status()).account).toEqual({ ...ACCOUNT, perfs: account?.perfs });
    await vi.waitFor(() =>
      expect(events.at(-1)).toMatchObject({
        type: "status",
        status: { account: { perfs: account?.perfs } }
      })
    );
  });

  it("reads no ratings without an account, and fails when Lichess can't be reached", async () => {
    const signedOut = await setup({}, { connected: false });
    expect(await signedOut.service.refreshAccount()).toBeNull();
    expect(signedOut.requests).toHaveLength(0);
    const offline = await setup({
      "GET /api/account": () => Promise.reject(new TypeError("fetch failed"))
    });
    await expect(offline.service.refreshAccount()).rejects.toThrow(/fetch failed|reach/i);
    expect((await offline.store.status()).account).toEqual(ACCOUNT);
  });

  it("reports a failed import", async () => {
    const { service, events } = await setup({ "GET /api/games/user/Kenneth": () => json({}, 429) });
    await expect(service.syncGames()).rejects.toThrow(/Try again in a minute/);
    expect(events.at(-1)).toMatchObject({
      type: "sync",
      running: false,
      error: expect.stringMatching(/minute/)
    });
  });
});
