import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameSource, SaveGameInput } from "@chaturanga/shared/types/chess";
import type { ChesscomEvent } from "@chaturanga/shared/types/chesscom";
import { fakeChesscom, fixture, Live } from "./__fixtures__/fake-chesscom";
import { ChesscomAccountStore } from "./account-store";
import { ChesscomService, type ChesscomGameStore } from "./chesscom-service";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));

const NOW = Date.UTC(2026, 9, 6);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

async function storePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "chaturanga-chesscom-"));
  temporaryDirectories.push(directory);
  return join(directory, "chesscom-account.json");
}

function memoryGames() {
  const games: { input: SaveGameInput; playedAt: number }[] = [];
  const removed: GameSource[] = [];
  const store: ChesscomGameStore = {
    findIdBySite: (site) => (games.some((game) => game.input.headers.site === site) ? "id" : null),
    saveImported: (input, playedAt) => games.push({ input, playedAt }),
    removeBySource: (source) => {
      removed.push(source);
      const before = games.length;
      games.splice(0, games.length, ...games.filter((game) => game.input.source !== source));
      return before - games.length;
    }
  };
  return { store, games, removed };
}

const ROUTES = {
  "/pub/player/ayush_p64": fixture("profile"),
  "/pub/player/ayush_p64/stats": fixture("stats"),
  "/pub/player/ayush_p64/games/archives": fixture("archives"),
  "/pub/player/ayush_p64/games/2026/08": { games: [] },
  "/pub/player/ayush_p64/games/2026/09": fixture("archive-2026-09"),
  "/pub/player/ayush_p64/games/2026/10": fixture("archive-2026-10")
};

async function setup(routes: Parameters<typeof fakeChesscom>[0] = ROUTES) {
  const path = await storePath();
  const fake = fakeChesscom(routes);
  const games = memoryGames();
  const store = new ChesscomAccountStore(path);
  const service = new ChesscomService({
    store,
    games: games.store,
    userAgent: "Chaturanga/test",
    fetch: fake.fetch,
    now: () => NOW
  });
  const events: ChesscomEvent[] = [];
  service.on("event", (event) => events.push(event));
  return { path, fake, games, store, service, events };
}

/** Resolves once the service reports an import finished. */
function importDone(service: ChesscomService): Promise<ChesscomEvent> {
  return new Promise((resolve) => {
    const listener = (event: ChesscomEvent) => {
      if (event.type !== "sync" || event.running) return;
      service.off("event", listener);
      resolve(event);
    };
    service.on("event", listener);
  });
}

describe("ChesscomService", () => {
  it("connects a username that exists, saves only public facts, then imports on its own", async () => {
    const { path, service, games } = await setup();
    const finished = importDone(service);
    const status = await service.connect({ username: "Ayush_P64", firstImport: "all" });
    expect(status).toEqual({
      connecting: false,
      account: {
        id: "ayush_p64",
        username: "Ayush_P64",
        title: null,
        ratings: { rapid: 1684, blitz: 1662, bullet: 1490, daily: 1550 },
        connectedAt: NOW,
        lastSyncAt: null
      }
    });
    expect(await finished).toMatchObject({ imported: 3, error: null });
    expect(games.games).toHaveLength(3);
    expect((await service.status()).account?.lastSyncAt).toBe(NOW);
    // The file holds the username, ratings and import progress: nothing secret.
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      account: expect.objectContaining({ id: "ayush_p64" }),
      firstImport: "all",
      cursor: { month: "2026/10", endTime: 1790950000 }
    });
  });

  it("refuses a username chess.com doesn't know, and stays disconnected", async () => {
    const { service, events } = await setup();
    await expect(service.connect({ username: "nobody", firstImport: "year" })).rejects.toThrow(
      "Chess.com has no player called nobody."
    );
    expect(await service.status()).toEqual({ account: null, connecting: false });
    // Connecting showed, then ended.
    const statuses = events.flatMap((event) => (event.type === "status" ? [event.status] : []));
    await vi.waitFor(() => expect(statuses.at(-1)).toEqual({ account: null, connecting: false }));
  });

  it("imports only new games on the next run", async () => {
    const { service, fake } = await setup();
    await service.connect({ username: "ayush_p64", firstImport: "all" });
    // Joins the import the connect started.
    expect(await service.syncGames()).toEqual({ imported: 3, skipped: 1 });
    fake.requests.length = 0;
    expect(await service.syncGames()).toEqual({ imported: 0, skipped: 0 });
    // From the cursor's month only.
    expect(fake.requests.map((request) => request.path)).toEqual([
      "/pub/player/ayush_p64/games/archives",
      "/pub/player/ayush_p64/games/2026/10"
    ]);
  });

  it("disconnects, removing the imported games only when asked", async () => {
    const first = await setup();
    let finished = importDone(first.service);
    await first.service.connect({ username: "ayush_p64", firstImport: "all" });
    await finished;
    expect(await first.service.disconnect({ removeGames: false })).toEqual({
      account: null,
      connecting: false
    });
    expect(first.games.removed).toEqual([]);
    expect(first.games.games).toHaveLength(3);

    finished = importDone(first.service);
    await first.service.connect({ username: "ayush_p64", firstImport: "all" });
    await finished;
    await first.service.disconnect({ removeGames: true });
    expect(first.games.removed).toEqual(["chesscom"]);
    expect(first.games.games).toEqual([]);
  });

  it("refreshes the ratings of the connected account", async () => {
    const stats = { chess_blitz: { last: { rating: 1700 } } };
    const { service } = await setup({
      ...ROUTES,
      "/pub/player/ayush_p64/stats": new Live(() => stats)
    });
    const finished = importDone(service);
    await service.connect({ username: "ayush_p64", firstImport: "year" });
    await finished;
    stats.chess_blitz.last.rating = 1712;
    expect((await service.refreshAccount())?.ratings).toEqual({ blitz: 1712 });
    await service.disconnect({ removeGames: false });
    expect(await service.refreshAccount()).toBeNull();
  });

  it("can't import without an account", async () => {
    const { service } = await setup();
    await expect(service.syncGames()).rejects.toThrow(/Connect your chess.com account/);
  });
});
