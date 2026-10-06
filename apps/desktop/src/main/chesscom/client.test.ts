import { describe, expect, it } from "vitest";
import { fakeChesscom, fixture, Refusal } from "./__fixtures__/fake-chesscom";
import {
  archiveMonthOf,
  ChesscomClient,
  ChesscomHttpError,
  CHESSCOM_RATE_LIMITED_ERROR,
  parseArchiveGames,
  parseArchiveMonths,
  parseProfile,
  parseStats,
  playerPath
} from "./client";

describe("chess.com API answers", () => {
  it("reads a profile: the id, the name as chess.com shows it, and a title", () => {
    expect(parseProfile(fixture("profile"))).toEqual({
      id: "ayush_p64",
      username: "Ayush_P64",
      title: null
    });
    expect(
      parseProfile({ username: "hikaru", url: "https://www.chess.com/member/Hikaru", title: "GM" })
    ).toEqual({ id: "hikaru", username: "Hikaru", title: "GM" });
    // A profile URL naming someone else, or an odd title, isn't trusted.
    expect(
      parseProfile({ username: "erik", url: "https://www.chess.com/member/Other", title: "<b>" })
    ).toEqual({ id: "erik", username: "erik", title: null });
    for (const answer of [null, [], { username: 5 }, { username: "../x" }, { code: 0 }])
      expect(parseProfile(answer)).toBeNull();
  });

  it("reads the standard ratings (Daily included), not the variants, tactics or puzzles", () => {
    expect(parseStats(fixture("stats"))).toEqual({
      rapid: 1684,
      blitz: 1662,
      bullet: 1490,
      daily: 1550
    });
    expect(parseStats({ chess_rapid: { last: { rating: "1500" } }, chess_blitz: {} })).toEqual({});
    expect(parseStats(null)).toEqual({});
  });

  it("lists the archive months oldest first, from well-formed URLs only", () => {
    expect(parseArchiveMonths(fixture("archives"))).toEqual(["2026/08", "2026/09", "2026/10"]);
    expect(parseArchiveMonths({ archives: "nope" })).toEqual([]);
    expect(parseArchiveMonths(undefined)).toEqual([]);
    expect(archiveMonthOf(Date.UTC(2026, 0, 31, 23, 59))).toBe("2026/01");
    expect(archiveMonthOf(Date.UTC(2026, 9, 1))).toBe("2026/10");
  });

  it("keeps an archive's games that have a chess.com URL and an end time", () => {
    const games = parseArchiveGames(fixture("archive-2026-09"));
    expect(games.map((game) => [game.url, game.rules, game.endTime])).toEqual([
      ["https://www.chess.com/game/live/150000001", "chess", 1790791330],
      ["https://www.chess.com/game/daily/150000002", "chess960", 1790000000],
      ["https://www.chess.com/game/live/150000003", "chess", 1790300000]
    ]);
    expect(games[0]!.pgn).toContain('[Link "https://www.chess.com/game/live/150000001"]');
    // No rules: it can't be told from a variant, so it isn't taken as standard chess.
    expect(
      parseArchiveGames({
        games: [{ url: "https://www.chess.com/game/live/9", pgn: "1. e4 *", end_time: 5 }]
      })
    ).toEqual([
      { url: "https://www.chess.com/game/live/9", pgn: "1. e4 *", rules: "", endTime: 5 }
    ]);
    expect(parseArchiveGames({ games: {} })).toEqual([]);
  });

  it("builds player paths from the lowercased username, escaped", () => {
    expect(playerPath("Ayush_P64", "/stats")).toBe("/pub/player/ayush_p64/stats");
    expect(playerPath("a/b")).toBe("/pub/player/a%2Fb");
  });
});

describe("ChesscomClient", () => {
  it("sends one request at a time, naming the app", async () => {
    const { fetch, requests, state } = fakeChesscom({
      "/pub/player/a": { username: "a" },
      "/pub/player/b": { username: "b" },
      "/pub/player/c": { username: "c" }
    });
    const client = new ChesscomClient({ fetch, userAgent: "Chaturanga/test" });
    const answers = await Promise.all(["a", "b", "c"].map((name) => client.json(playerPath(name))));
    expect(answers).toEqual([{ username: "a" }, { username: "b" }, { username: "c" }]);
    expect(state.maxInFlight).toBe(1);
    expect(requests).toEqual([
      { path: "/pub/player/a", userAgent: "Chaturanga/test" },
      { path: "/pub/player/b", userAgent: "Chaturanga/test" },
      { path: "/pub/player/c", userAgent: "Chaturanga/test" }
    ]);
  });

  it("says why a request was refused, and keeps going after one", async () => {
    const { fetch } = fakeChesscom({
      "/pub/player/busy": new Refusal(429),
      "/pub/player/down": new Refusal(503),
      "/pub/player/ok": { username: "ok" }
    });
    const client = new ChesscomClient({ fetch, userAgent: "test" });
    await expect(client.json("/pub/player/busy")).rejects.toThrow(CHESSCOM_RATE_LIMITED_ERROR);
    await expect(client.json("/pub/player/down")).rejects.toThrow(/trouble right now \(503\)/);
    const missing = await client.json("/pub/player/nobody").catch((error: unknown) => error);
    expect(missing).toBeInstanceOf(ChesscomHttpError);
    expect(missing).toMatchObject({ status: 404 });
    expect(await client.json("/pub/player/ok")).toEqual({ username: "ok" });
  });

  it("reports chess.com unreachable when the network fails, and only asks for API paths", async () => {
    const client = new ChesscomClient({
      fetch: () => Promise.reject(new TypeError("fetch failed")),
      userAgent: "test"
    });
    await expect(client.json("/pub/player/x")).rejects.toMatchObject({
      status: 0,
      message: expect.stringMatching(/Couldn't reach chess.com/)
    });
    await expect(client.json("https://evil.example/")).rejects.toThrow(/Not a chess.com API path/);
  });
});
