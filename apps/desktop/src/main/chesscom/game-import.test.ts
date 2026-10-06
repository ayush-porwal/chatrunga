import { describe, expect, it, vi } from "vitest";
import type { SaveGameInput } from "@chaturanga/shared/types/chess";
import { fakeChesscom, fixture, Refusal } from "./__fixtures__/fake-chesscom";
import { ChesscomClient } from "./client";
import {
  firstImportSince,
  IMPORT_WINDOW_MS,
  importChesscomGames,
  type ImportRepository
} from "./game-import";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));

const ARCHIVES = "/pub/player/ayush_p64/games/archives";
const AUGUST = "/pub/player/ayush_p64/games/2026/08";
const SEPTEMBER = "/pub/player/ayush_p64/games/2026/09";
const OCTOBER = "/pub/player/ayush_p64/games/2026/10";
/** 2026-10-06, after every fixture game. */
const NOW = Date.UTC(2026, 9, 6);

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

function chesscom(routes: Parameters<typeof fakeChesscom>[0] = {}) {
  const fake = fakeChesscom({
    [ARCHIVES]: fixture("archives"),
    [AUGUST]: { games: [] },
    [SEPTEMBER]: fixture("archive-2026-09"),
    [OCTOBER]: fixture("archive-2026-10"),
    ...routes
  });
  return { ...fake, client: new ChesscomClient({ fetch: fake.fetch, userAgent: "test" }) };
}

describe("firstImportSince", () => {
  it("reaches back three months, a year, or to the start", () => {
    expect(firstImportSince("3months", NOW)).toBe(NOW - IMPORT_WINDOW_MS["3months"]);
    expect(firstImportSince("year", NOW)).toBe(NOW - 365 * 24 * 60 * 60 * 1000);
    expect(firstImportSince("all", NOW)).toBe(0);
  });
});

describe("importChesscomGames", () => {
  it("imports the standard games, a month at a time and one request at a time", async () => {
    const { client, requests, state } = chesscom();
    const { repository, saved } = memoryRepository();
    const result = await importChesscomGames({
      client,
      repository,
      username: "ayush_p64",
      cursor: null,
      since: firstImportSince("all", NOW)
    });
    expect(requests.map((request) => request.path)).toEqual([ARCHIVES, AUGUST, SEPTEMBER, OCTOBER]);
    expect(state.maxInFlight).toBe(1);
    // The chess960 game is skipped; the malformed entries never reach the importer.
    expect(saved.map((item) => item.input.headers.site)).toEqual([
      "https://www.chess.com/game/live/150000001",
      "https://www.chess.com/game/live/150000003",
      "https://www.chess.com/game/live/150000010"
    ]);
    expect(result).toEqual({
      imported: 3,
      skipped: 1,
      nextCursor: { month: "2026/10", endTime: 1790950000 }
    });
    const first = saved[0]!;
    expect(first.playedAt).toBe(1790791330 * 1000);
    expect(first.input).toMatchObject({
      id: null,
      source: "chesscom",
      headers: {
        event: "Live Chess",
        site: "https://www.chess.com/game/live/150000001",
        white: "ayush_p64",
        black: "pawnstorm99",
        whiteElo: "1671",
        timeControl: "600",
        result: "0-1"
      }
    });
    // Clocks come through, and the stored PGN names the game's page as its site.
    expect(first.input.moveTree[1]!.clockAfter).toBeTruthy();
    expect(first.input.pgn).toContain('[Site "https://www.chess.com/game/live/150000001"]');
  });

  it("skips games already in the library (same chess.com URL), so a re-run is harmless", async () => {
    const { client } = chesscom();
    const { repository, saved } = memoryRepository([
      "https://www.chess.com/game/live/150000001",
      "https://www.chess.com/game/live/150000010"
    ]);
    const result = await importChesscomGames({
      client,
      repository,
      username: "ayush_p64",
      cursor: null,
      since: 0
    });
    expect(saved.map((item) => item.input.headers.site)).toEqual([
      "https://www.chess.com/game/live/150000003"
    ]);
    expect(result).toMatchObject({ imported: 1, skipped: 3 });
  });

  it("starts the first import at its window: older months aren't read, older games aren't taken", async () => {
    const { client, requests } = chesscom();
    const { repository, saved } = memoryRepository();
    // From 2026-09-26: September's archive is read, but its games before then are left.
    await importChesscomGames({
      client,
      repository,
      username: "ayush_p64",
      cursor: null,
      since: Date.UTC(2026, 8, 26)
    });
    expect(requests.map((request) => request.path)).toEqual([ARCHIVES, SEPTEMBER, OCTOBER]);
    expect(saved.map((item) => item.input.headers.site)).toEqual([
      "https://www.chess.com/game/live/150000001",
      "https://www.chess.com/game/live/150000010"
    ]);
  });

  it("continues from the cursor: its month again (for new games), then later ones", async () => {
    const { client, requests } = chesscom({
      [OCTOBER]: {
        games: [
          ...(fixture("archive-2026-10") as { games: unknown[] }).games,
          {
            url: "https://www.chess.com/game/live/150000011",
            pgn: '[White "a"]\n[Black "b"]\n[Result "*"]\n\n1. d4 d5 *',
            end_time: 1790960000,
            rules: "chess"
          }
        ]
      }
    });
    const { repository, saved } = memoryRepository();
    const result = await importChesscomGames({
      client,
      repository,
      username: "ayush_p64",
      cursor: { month: "2026/10", endTime: 1790950000 },
      since: 0
    });
    expect(requests.map((request) => request.path)).toEqual([ARCHIVES, OCTOBER]);
    // The game at the cursor was seen; only the newer one comes in.
    expect(saved.map((item) => item.input.headers.site)).toEqual([
      "https://www.chess.com/game/live/150000011"
    ]);
    expect(result.nextCursor).toEqual({ month: "2026/10", endTime: 1790960000 });
  });

  it("keeps the cursor when there's nothing new to read", async () => {
    const { client } = chesscom({ [ARCHIVES]: { archives: [] } });
    const cursor = { month: "2026/10", endTime: 1790950000 };
    const result = await importChesscomGames({
      client,
      repository: memoryRepository().repository,
      username: "ayush_p64",
      cursor,
      since: 0
    });
    expect(result).toEqual({ imported: 0, skipped: 0, nextCursor: cursor });
  });

  it("keeps the cursor before a game that failed to import, so the next import retries it", async () => {
    const { client } = chesscom({
      [SEPTEMBER]: {
        games: [
          {
            url: "https://www.chess.com/game/live/7",
            pgn: "1. e4 e5 2. Qxe5 *",
            end_time: 1790000100,
            rules: "chess"
          },
          {
            url: "https://www.chess.com/game/live/8",
            end_time: 1790000200,
            rules: "chess"
          }
        ]
      }
    });
    const { repository, saved } = memoryRepository();
    const result = await importChesscomGames({
      client,
      repository,
      username: "ayush_p64",
      cursor: null,
      since: 0
    });
    // October's game came in; the unreadable September one is tried again next time.
    expect(saved.map((item) => item.input.headers.site)).toEqual([
      "https://www.chess.com/game/live/150000010"
    ]);
    expect(result.nextCursor).toEqual({ month: "2026/09", endTime: 1790000099 });
  });

  it("stops when aborted, and rejects when chess.com refuses", async () => {
    const controller = new AbortController();
    controller.abort();
    const { client } = chesscom();
    await expect(
      importChesscomGames({
        client,
        repository: memoryRepository().repository,
        username: "ayush_p64",
        cursor: null,
        since: 0,
        signal: controller.signal
      })
    ).rejects.toThrow(/aborted/i);
    const busy = chesscom({ [SEPTEMBER]: new Refusal(429) });
    await expect(
      importChesscomGames({
        client: busy.client,
        repository: memoryRepository().repository,
        username: "ayush_p64",
        cursor: null,
        since: 0
      })
    ).rejects.toThrow(/limiting requests/);
  });
});
