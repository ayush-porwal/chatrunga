import { describe, expect, it, vi } from "vitest";
import type { SaveGameInput } from "@chaturanga/shared/types/chess";
import { fakeFetch, fakeStream } from "./__fixtures__/fake-lichess";
import {
  FIRST_SYNC_WINDOW_MS,
  importLichessGames,
  sinceForSync,
  type ImportRepository
} from "./game-import";
import { LichessClient } from "./http";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));

function pgn(
  id: string,
  moves = "1. e4 { [%clk 0:10:00] } e5 { [%clk 0:10:00] } 2. Nf3 1-0"
): string {
  return `[Event "Rated rapid game"]
[Site "https://lichess.org/${id}"]
[White "Kenneth"]
[Black "Salma"]
[Result "1-0"]
[TimeControl "600+5"]

${moves}
`;
}

function memoryRepository(existingSites: string[] = []) {
  const saved: { input: SaveGameInput; playedAt: number }[] = [];
  const sites = new Set(existingSites);
  const repository: ImportRepository = {
    findIdBySite: (site) => (sites.has(site) ? "existing-id" : null),
    saveImported: (input, playedAt) => {
      sites.add(input.headers.site!);
      saved.push({ input, playedAt });
    }
  };
  return { repository, saved };
}

function gamesExport(games: unknown[]) {
  const { fetch, requests } = fakeFetch({
    "GET /api/games/user/Kenneth": () => {
      const stream = fakeStream();
      queueMicrotask(() => {
        for (const game of games) stream.push(game);
        stream.close();
      });
      return stream.response;
    }
  });
  return { client: new LichessClient({ fetch, getToken: async () => "token" }), requests };
}

describe("sinceForSync", () => {
  it("reaches back a year on the first import, then continues from the cursor", () => {
    const now = 1_800_000_000_000;
    expect(sinceForSync(null, now)).toBe(now - FIRST_SYNC_WINDOW_MS);
    expect(sinceForSync(1_799_000_000_123, now)).toBe(1_799_000_000_123);
  });
});

describe("importLichessGames", () => {
  it("keeps the cursor before a game that failed to import, so the next import retries it", async () => {
    const { client } = gamesExport([
      {
        id: "good0001",
        variant: "standard",
        createdAt: 100,
        lastMoveAt: 5000,
        moves: "e4 e5 Nf3",
        pgn: pgn("good0001")
      },
      {
        id: "broken02",
        variant: "standard",
        createdAt: 300,
        lastMoveAt: 4000,
        moves: "e4 e5",
        pgn: "not a pgn at all"
      },
      { id: "missing1", variant: "standard", createdAt: 400, lastMoveAt: 4500, moves: "d4" }
    ]);
    const { repository, saved } = memoryRepository();
    const result = await importLichessGames({ client, repository, username: "Kenneth", since: 50 });
    expect(saved).toHaveLength(1);
    expect(result).toEqual({ imported: 1, skipped: 2, nextSince: 300 });
  });

  it("imports new games as Lichess games dated by their last move, and skips ones already there", async () => {
    const { client, requests } = gamesExport([
      {
        id: "newGame1",
        variant: "standard",
        createdAt: 100,
        lastMoveAt: 5000,
        pgn: pgn("newGame1")
      },
      {
        id: "oldGame1",
        variant: "standard",
        createdAt: 50,
        lastMoveAt: 4000,
        pgn: pgn("oldGame1")
      },
      // Lichess sends each game once, but a repeated line must not duplicate it either.
      {
        id: "newGame1",
        variant: "standard",
        createdAt: 100,
        lastMoveAt: 5000,
        pgn: pgn("newGame1")
      },
      { id: "atomic01", variant: "atomic", createdAt: 10, lastMoveAt: 3000, pgn: pgn("atomic01") },
      {
        id: "broken01",
        variant: "standard",
        createdAt: 10,
        lastMoveAt: 2000,
        pgn: "not a pgn at all"
      }
    ]);
    const { repository, saved } = memoryRepository(["https://lichess.org/oldGame1"]);
    const result = await importLichessGames({
      client,
      repository,
      username: "Kenneth",
      since: 1234
    });

    expect(result).toEqual({ imported: 1, skipped: 4, nextSince: 5001 });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.playedAt).toBe(5000);
    expect(saved[0]!.input).toMatchObject({
      id: null,
      source: "lichess",
      headers: {
        site: "https://lichess.org/newGame1",
        white: "Kenneth",
        black: "Salma",
        result: "1-0"
      }
    });
    expect(saved[0]!.input.moveTree.map((node) => node.san).filter(Boolean)).toEqual([
      "e4",
      "e5",
      "Nf3"
    ]);
    expect(saved[0]!.input.pgn).toContain('[Site "https://lichess.org/newGame1"]');

    const url = new URL(requests[0]!.url);
    expect(url.pathname).toBe("/api/games/user/Kenneth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      since: "1234",
      pgnInJson: "true",
      clocks: "true",
      opening: "true",
      finished: "true"
    });
    expect(requests[0]!.headers.accept).toBe("application/x-ndjson");
  });

  it("adds the Site header when the PGN lacks it", async () => {
    const withoutSite = pgn("noSite01").replace(/\[Site "[^"]*"\]\n/, "");
    const { client } = gamesExport([
      { id: "noSite01", variant: "standard", lastMoveAt: 10, pgn: withoutSite }
    ]);
    const { repository, saved } = memoryRepository();
    await importLichessGames({ client, repository, username: "Kenneth", since: 0 });
    expect(saved[0]!.input.headers.site).toBe("https://lichess.org/noSite01");
    expect(saved[0]!.input.pgn).toContain('[Site "https://lichess.org/noSite01"]');
  });

  it("has no cursor when there was nothing new", async () => {
    const { client } = gamesExport([]);
    const { repository } = memoryRepository();
    expect(await importLichessGames({ client, repository, username: "Kenneth", since: 0 })).toEqual(
      {
        imported: 0,
        skipped: 0,
        nextSince: null
      }
    );
  });
});
