import { describe, expect, it } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import type { GameSummary } from "@chaturanga/shared/types/chess";
import { emptyTabCounts, type LibraryTabCounts } from "@chaturanga/shared/types/library";
import {
  playerName,
  recentGamesFilterOptions,
  recentGamesFilterTab,
  recentRows,
  reviewSummary,
  accountUsernames,
  savedGameFacts,
  scoresFor,
  userSide,
  yourSideOf
} from "./recent-games";

const summary = (id: string, overrides: Partial<GameSummary> = {}): GameSummary => ({
  id,
  source: "pgn-import",
  white: "Alpha",
  black: "Beta",
  event: null,
  result: "*",
  date: null,
  currentFen: "",
  updatedAt: 0,
  reviewCount: 0,
  lastReviewedAt: null,
  ...overrides
});

describe("Recent games rows", () => {
  it("shows the newest ten, leaving out the In progress card's game", () => {
    const games = Array.from({ length: 11 }, (_, index) => summary(`g${index}`));
    expect(recentRows(games, null).map((game) => game.id)).toStrictEqual(
      games.slice(0, 10).map((game) => game.id)
    );
    // Taking one out still leaves ten (the page reads eleven).
    expect(recentRows(games, "g3")).toHaveLength(10);
    expect(recentRows(games, "g3").map((game) => game.id)).not.toContain("g3");
  });

  it("scores each side once decided, nothing while in progress", () => {
    expect(scoresFor("1-0")).toStrictEqual({ white: "1", black: "0" });
    expect(scoresFor("0-1")).toStrictEqual({ white: "0", black: "1" });
    expect(scoresFor("1/2-1/2")).toStrictEqual({ white: "½", black: "½" });
    expect(scoresFor("*")).toBeNull();
    expect(scoresFor(null)).toBeNull();
  });

  it("names players plainly: engines without the managed marker, unnamed sides by colour", () => {
    const game = summary("g", { white: "Stockfish (managed)", black: "  " });
    expect(playerName(game, "white")).toBe("Stockfish");
    expect(playerName(game, "black")).toBe("Black");
  });

  it("turns the thumbnail to the side you played", () => {
    expect(userSide(summary("g", { white: "Stockfish", black: "You" }), [])).toBe("black");
    expect(
      userSide(summary("g", { white: "tempo_thief", black: "Kakashi" }), [null, "kakashi"])
    ).toBe("black");
    // Nobody known: White at the bottom.
    expect(userSide(summary("g"), ["someone_else"])).toBe("white");
  });

  it("knows your side only from a You side or a connected account's name", () => {
    expect(yourSideOf(summary("g", { white: "You", black: "Maia 1500" }), [])).toBe("white");
    // The "You" side first, then Lichess, then Chess.com.
    expect(yourSideOf(summary("g", { white: "You", black: "ayush" }), ["ayush"])).toBe("white");
    expect(
      yourSideOf(summary("g", { white: "Ayush", black: "kakashi" }), ["ayush", "kakashi"])
    ).toBe("white");
    // Someone else's game, a free board (both or neither "You"): nobody's yours.
    expect(yourSideOf(summary("g"), [null, "someone_else"])).toBeNull();
    expect(yourSideOf(summary("g", { white: "You", black: "You" }), [])).toBeNull();
    expect(yourSideOf(summary("g", { white: null, black: null }), ["ayush"])).toBeNull();
  });

  it("names you in a Lichess or Chess.com game by that site's account only", () => {
    const accounts = { lichess: "ayush", chesscom: "kakashi" };
    // A Chess.com game whose opponent shares your Lichess name: only the Chess.com name is yours.
    const chesscomGame = summary("g", { source: "chesscom", white: "ayush", black: "kakashi" });
    expect(yourSideOf(chesscomGame, accountUsernames("chesscom", accounts))).toBe("black");
    const lichessGame = summary("g", { source: "lichess", white: "kakashi", black: "ayush" });
    expect(yourSideOf(lichessGame, accountUsernames("lichess", accounts))).toBe("black");
    // Its site's account not connected: the other site's name doesn't count.
    expect(
      yourSideOf(chesscomGame, accountUsernames("chesscom", { ...accounts, chesscom: null }))
    ).toBeNull();
    // Any other game: either account's name, Lichess first; a "You" side still wins.
    expect(accountUsernames("pgn-import", accounts)).toStrictEqual(["ayush", "kakashi"]);
    expect(accountUsernames(null, accounts)).toStrictEqual(["ayush", "kakashi"]);
    expect(
      yourSideOf(
        summary("g", { source: "chesscom", white: "You", black: "kakashi" }),
        accountUsernames("chesscom", accounts)
      )
    ).toBe("white");
  });

  it("counts the main line in full moves and tints the move on the board", () => {
    const { game } = importPgnText("1. e4 e5 2. Nf3 Nc6 3. Bb5 (3. Bc4 Bc5) 3... a6 *");
    const facts = savedGameFacts(game);
    // Five plies of main line (the variation doesn't count): three moves.
    expect(facts.moves).toBe(3);
    // The board's move: the last of the main line, 3… a6.
    expect(facts.lastMoveUci).toBe("a7a6");
    expect(savedGameFacts({ ...game, moveTree: game.moveTree.slice(0, 1) }).moves).toBe(0);
  });

  it("says what the newest analysis found", () => {
    const review = (blunders: number, mistakes: number, inaccuracies: number) =>
      ({ review: { summary: { blunders, mistakes, inaccuracies } } }) as Parameters<
        typeof reviewSummary
      >[0];
    expect(reviewSummary(review(2, 1, 0))).toBe("3 errors found");
    expect(reviewSummary(review(0, 1, 4))).toBe("1 error found");
    expect(reviewSummary(review(0, 0, 1))).toBe("1 inaccuracy, no errors");
    expect(reviewSummary(review(0, 0, 0))).toBe("No errors found");
    expect(reviewSummary({ review: null })).toBe("Reviewed");
  });

  describe("source filter", () => {
    const counts = (games: Partial<Record<keyof LibraryTabCounts, number>>): LibraryTabCounts => {
      const all = emptyTabCounts();
      for (const [tab, count] of Object.entries(games)) {
        all[tab as keyof LibraryTabCounts] = { games: count, reviewed: 0 };
      }
      return all;
    };

    it("offers All games, then each source with games in tab order, with their counts", () => {
      expect(recentGamesFilterOptions(counts({ engine: 2, lichess: 5 }), null)).toStrictEqual([
        { tab: null, label: "All games", count: 7 },
        { tab: "lichess", label: "Lichess", count: 5 },
        { tab: "engine", label: "Engine", count: 2 }
      ]);
    });

    it("leaves the In progress card's game out of its source and the total", () => {
      const options = recentGamesFilterOptions(counts({ engine: 1, chesscom: 3 }), "engine");
      // Its source's only game: the source isn't offered.
      expect(options).toStrictEqual([
        { tab: null, label: "All games", count: 3 },
        { tab: "chesscom", label: "Chess.com", count: 3 }
      ]);
      expect(recentGamesFilterOptions(counts({}), null)).toStrictEqual([
        { tab: null, label: "All games", count: 0 }
      ]);
    });

    it("keeps the chosen source while it is offered, else lists every game", () => {
      const two = recentGamesFilterOptions(counts({ lichess: 2, imported: 1 }), null);
      expect(recentGamesFilterTab(two, "imported")).toBe("imported");
      expect(recentGamesFilterTab(two, null)).toBeNull();
      // Its games were deleted.
      expect(recentGamesFilterTab(two, "engine")).toBeNull();
      // One source left: the filter isn't offered, so it no longer applies.
      const one = recentGamesFilterOptions(counts({ lichess: 2 }), null);
      expect(recentGamesFilterTab(one, "lichess")).toBeNull();
    });
  });
});
