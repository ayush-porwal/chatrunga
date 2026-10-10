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
  savedGameFacts,
  scoresFor,
  userSide
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
    expect(recentRows(games, null).map((game) => game.id)).toEqual(
      games.slice(0, 10).map((game) => game.id)
    );
    // Taking one out still leaves ten (the page reads eleven).
    expect(recentRows(games, "g3")).toHaveLength(10);
    expect(recentRows(games, "g3").map((game) => game.id)).not.toContain("g3");
  });

  it("scores each side once decided, nothing while in progress", () => {
    expect(scoresFor("1-0")).toEqual({ white: "1", black: "0" });
    expect(scoresFor("0-1")).toEqual({ white: "0", black: "1" });
    expect(scoresFor("1/2-1/2")).toEqual({ white: "½", black: "½" });
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

  it("counts the main line in full moves and tints the move on the board", () => {
    const { game } = importPgnText("1. e4 e5 2. Nf3 Nc6 3. Bb5 (3. Bc4 Bc5) 3... a6 *");
    const facts = savedGameFacts(game);
    // Five plies of main line (the variation doesn't count): three moves.
    expect(facts.moves).toBe(3);
    const current = game.moveTree.find((node) => node.id === game.currentNodeId);
    expect(facts.lastMoveUci).toBe(current?.uci ?? null);
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
      expect(recentGamesFilterOptions(counts({ engine: 2, lichess: 5 }), null)).toEqual([
        { tab: null, label: "All games", count: 7 },
        { tab: "lichess", label: "Lichess", count: 5 },
        { tab: "engine", label: "Engine", count: 2 }
      ]);
    });

    it("leaves the In progress card's game out of its source and the total", () => {
      const options = recentGamesFilterOptions(counts({ engine: 1, chesscom: 3 }), "engine");
      // Its source's only game: the source isn't offered.
      expect(options).toEqual([
        { tab: null, label: "All games", count: 3 },
        { tab: "chesscom", label: "Chess.com", count: 3 }
      ]);
      expect(recentGamesFilterOptions(counts({}), null)).toEqual([
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
