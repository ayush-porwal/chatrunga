import { describe, expect, it } from "vitest";
import type { GameSummary } from "@chaturanga/shared/types/chess";
import { gamesOfPages } from "./game-pages";

const game = (id: string): GameSummary => ({
  id,
  source: "pgn-import",
  white: null,
  black: null,
  event: null,
  result: null,
  date: null,
  currentFen: "startpos",
  updatedAt: 0,
  reviewCount: 0,
  lastReviewedAt: null
});

describe("gamesOfPages", () => {
  it("lists the fetched pages in order, each game once", () => {
    expect(gamesOfPages(undefined)).toEqual([]);
    const pages = [
      { items: [game("a"), game("b")], nextCursor: { updatedAt: 0, id: "b" } },
      { items: [game("c"), game("a")], nextCursor: null }
    ];
    expect(gamesOfPages(pages).map((item) => item.id)).toEqual(["a", "b", "c"]);
  });
});
