import { describe, expect, it } from "vitest";
import type { GameSource } from "./chess";
import { GAME_SOURCES, isGameSource, LIBRARY_TABS, libraryTabOf, sourcesOfTab } from "./library";

/** Every source, spelled out: a new one fails here until it's given a tab. */
const EVERY_SOURCE: Record<GameSource, true> = {
  new: true,
  "pgn-import": true,
  "engine-game": true,
  analysis: true,
  puzzle: true,
  lichess: true,
  chesscom: true
};

describe("library tabs", () => {
  it("puts every game source under exactly one tab", () => {
    expect([...GAME_SOURCES].sort()).toStrictEqual(Object.keys(EVERY_SOURCE).sort());
    const listed = LIBRARY_TABS.flatMap((tab) => sourcesOfTab(tab));
    expect([...listed].sort()).toStrictEqual([...GAME_SOURCES].sort());
    for (const source of GAME_SOURCES) expect(sourcesOfTab(libraryTabOf(source))).toContain(source);
  });

  it("maps each source to its tab; games made in the app are Chaturanga's", () => {
    expect(
      Object.fromEntries(GAME_SOURCES.map((source) => [source, libraryTabOf(source)]))
    ).toStrictEqual({
      lichess: "lichess",
      chesscom: "chesscom",
      "pgn-import": "imported",
      "engine-game": "engine",
      new: "chaturanga",
      analysis: "chaturanga",
      puzzle: "chaturanga"
    });
    expect(LIBRARY_TABS).toStrictEqual(["lichess", "chesscom", "imported", "engine", "chaturanga"]);
  });

  it("tells a game source from anything else", () => {
    expect(isGameSource("chesscom")).toBe(true);
    for (const value of ["other", "all", "", "toString", null, 3])
      expect(isGameSource(value)).toBe(false);
  });
});
