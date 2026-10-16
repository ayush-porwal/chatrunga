import { parsePgn } from "chessops/pgn";
import { describe, expect, it } from "vitest";
import { START_FEN } from "@chaturanga/shared/chess/position";
import {
  gameIdFromUrl,
  liveGameFromPgn,
  normalizeRoundDetail,
  normalizeStandings,
  normalizeTopPage,
  normalizeTourDetail
} from "./normalize";

const TOUR = {
  id: "I0twtRcA",
  name: "Knight Invitational",
  slug: "knight-invitational",
  info: { tc: "90+30", fideTC: "standard", location: "Oslo" },
  createdAt: 1789845989550,
  url: "https://lichess.org/broadcast/knight-invitational/I0twtRcA",
  tier: 5,
  dates: [1789845989705, 1790845989705],
  image: "https://image.lichess1.org/display?path=relay:I0twtRcA.jpg"
};

const ROUND = {
  id: "cBQZNLYn",
  name: "Round 1",
  slug: "round-1",
  ongoing: true,
  startsAt: 1789849589620,
  url: "https://lichess.org/broadcast/knight-invitational/round-1/cBQZNLYn"
};

describe("broadcast lists and tournaments", () => {
  it("reads the top page, skipping entries without an id or name", () => {
    const page = normalizeTopPage({
      active: [{ tour: TOUR, round: ROUND, group: "Knight Series" }, { tour: { name: "No id" } }],
      upcoming: [],
      past: { currentPageResults: [{ tour: { ...TOUR, id: "Pastpast" } }], nextPage: 2 }
    });
    expect(page.active).toHaveLength(1);
    expect(page.active[0]).toMatchObject({
      tour: {
        id: "I0twtRcA",
        tier: 5,
        dates: { start: 1789845989705, end: 1790845989705 },
        info: { timeControl: "90+30", fideTimeControl: "standard", location: "Oslo" }
      },
      round: { id: "cBQZNLYn", ongoing: true, finished: false },
      group: "Knight Series"
    });
    expect(page.past.map((listing) => [listing.tour.id, listing.round])).toStrictEqual([
      ["Pastpast", null]
    ]);
    expect(page.nextPastPage).toBe(2);
  });

  it("keeps images from Lichess's image host only", () => {
    const page = normalizeTopPage({
      active: [
        { tour: TOUR },
        { tour: { ...TOUR, id: "Elsewher", image: "https://example.com/banner.jpg" } }
      ]
    });
    expect(page.active.map((listing) => listing.tour.image)).toStrictEqual([TOUR.image, null]);
  });

  it("reads a tournament's rounds and drops a default round it doesn't list", () => {
    const detail = normalizeTourDetail({
      tour: TOUR,
      rounds: [ROUND, { ...ROUND, id: "Round002", name: "Round 2", finishedAt: 5 }],
      defaultRoundId: "Missing1"
    });
    expect(detail.rounds.map((round) => [round.id, round.finished])).toStrictEqual([
      ["cBQZNLYn", false],
      ["Round002", true]
    ]);
    expect(detail.defaultRoundId).toBeNull();
  });
});

describe("a round's boards", () => {
  it("reads players, clocks (centiseconds) and positions", () => {
    const detail = normalizeRoundDetail({
      tour: TOUR,
      round: ROUND,
      games: [
        {
          id: "1jbwRQGy",
          name: "Player 1 - Player 2",
          fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
          players: [
            { name: "Player 1", title: "GM", rating: 2700, fed: "NOR", fideId: 123, clock: 360000 },
            { name: "Player 2", fideId: 456, clock: 355050 }
          ],
          lastMove: "e7e5",
          thinkTime: 42,
          status: "*"
        },
        { id: "Finished", players: [{ name: "A" }, { name: "B" }], status: "½-½", thinkTime: 3 },
        { name: "No id" }
      ]
    });
    expect(detail.games).toStrictEqual([
      {
        id: "1jbwRQGy",
        name: "Player 1 - Player 2",
        white: { name: "Player 1", title: "GM", rating: 2700, federation: "NOR", fideId: 123 },
        black: { name: "Player 2", title: null, rating: null, federation: null, fideId: 456 },
        whiteClockMs: 3_600_000,
        blackClockMs: 3_550_500,
        fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
        lastMove: "e7e5",
        thinkTimeSec: 42,
        result: "*"
      },
      expect.objectContaining({ id: "Finished", fen: START_FEN, thinkTimeSec: null, result: "½-½" })
    ]);
  });

  it("reads standings, taking the first rating change and performance Lichess lists", () => {
    expect(
      normalizeStandings([
        {
          name: "Player 1",
          rating: 2700,
          score: 4.5,
          played: 6,
          rank: 1,
          ratingDiffs: { standard: 9.4 },
          performances: { standard: 2912 }
        },
        { score: 1 }
      ])
    ).toStrictEqual([
      {
        name: "Player 1",
        title: null,
        rating: 2700,
        federation: null,
        fideId: null,
        rank: 1,
        score: 4.5,
        played: 6,
        performance: 2912,
        ratingDiff: 9.4
      }
    ]);
  });
});

describe("the live PGN stream", () => {
  const PGN = `[Event "Knight Invitational"]
[Round "1.2"]
[White "Carlsen, Magnus"]
[Black "Gukesh D"]
[WhiteElo "2837"]
[WhiteTitle "GM"]
[WhiteFed "NOR"]
[BlackFideId "46616543"]
[Result "*"]
[GameURL "https://lichess.org/broadcast/knight-invitational/round-1/cBQZNLYn/1jbwRQGy"]

1. e4 { [%clk 1:59:58] } e5 { [%clk 1:59:50] } 2. Nf3 { [%clk 1:58:01] } *
`;

  it("reads a game's id, players, moves and clocks", () => {
    const [game] = parsePgn(PGN);
    const live = liveGameFromPgn(game, "cBQZNLYn");
    expect(live).toMatchObject({
      id: "1jbwRQGy",
      roundId: "cBQZNLYn",
      white: { name: "Carlsen, Magnus", title: "GM", rating: 2837, federation: "NOR" },
      black: { name: "Gukesh D", fideId: 46616543, rating: null },
      initialFen: START_FEN,
      lastMove: "g1f3",
      result: "*",
      headers: { event: "Knight Invitational", round: "1.2" }
    });
    expect(live?.moves).toStrictEqual([
      { uci: "e2e4", san: "e4", clock: "1:59:58" },
      { uci: "e7e5", san: "e5", clock: "1:59:50" },
      { uci: "g1f3", san: "Nf3", clock: "1:58:01" }
    ]);
  });

  it("stops at a move that can't be played and skips a game without its URL", () => {
    const [broken] = parsePgn(PGN.replace("2. Nf3", "2. Nf6"));
    expect(liveGameFromPgn(broken, "cBQZNLYn")?.moves.map((move) => move.san)).toStrictEqual([
      "e4",
      "e5"
    ]);
    const [anonymous] = parsePgn(PGN.replace(/\[GameURL.*\n/, ""));
    expect(liveGameFromPgn(anonymous, "cBQZNLYn")).toBeNull();
  });

  it("takes the game id from the end of its URL", () => {
    expect(gameIdFromUrl("https://lichess.org/broadcast/a/b/cBQZNLYn/1jbwRQGy/")).toBe("1jbwRQGy");
    expect(gameIdFromUrl("https://lichess.org/broadcast/a/b/cBQZNLYn/1jbwRQGy?x=1")).toBe(
      "1jbwRQGy"
    );
    expect(gameIdFromUrl("https://lichess.org/abc")).toBeNull();
  });
});
