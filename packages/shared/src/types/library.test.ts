import { describe, expect, it } from "vitest";
import type { GameSource } from "./chess";
import {
  defaultLibraryTab,
  emptyTabCounts,
  GAME_SOURCES,
  isGameSource,
  LIBRARY_TABS,
  libraryTabOf,
  sourcesOfTab,
  visibleLibraryTabs,
  type LibraryTabCounts
} from "./library";

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

function counts(games: Partial<Record<keyof LibraryTabCounts, number>>): LibraryTabCounts {
  const all = emptyTabCounts();
  for (const tab of LIBRARY_TABS) all[tab].games = games[tab] ?? 0;
  return all;
}

describe("library tabs", () => {
  it("puts every game source under exactly one tab", () => {
    expect([...GAME_SOURCES].sort()).toEqual(Object.keys(EVERY_SOURCE).sort());
    const listed = LIBRARY_TABS.flatMap((tab) => sourcesOfTab(tab));
    expect([...listed].sort()).toEqual([...GAME_SOURCES].sort());
    for (const source of GAME_SOURCES) expect(sourcesOfTab(libraryTabOf(source))).toContain(source);
  });

  it("maps each source to its tab; games made in the app are Chaturanga's", () => {
    expect(
      Object.fromEntries(GAME_SOURCES.map((source) => [source, libraryTabOf(source)]))
    ).toEqual({
      lichess: "lichess",
      chesscom: "chesscom",
      "pgn-import": "imported",
      "engine-game": "engine",
      new: "chaturanga",
      analysis: "chaturanga",
      puzzle: "chaturanga"
    });
    expect(LIBRARY_TABS).toEqual(["lichess", "chesscom", "imported", "engine", "chaturanga"]);
  });

  it("tells a game source from anything else", () => {
    expect(isGameSource("chesscom")).toBe(true);
    for (const value of ["other", "all", "", "toString", null, 3])
      expect(isGameSource(value)).toBe(false);
  });

  it("shows only the tabs with games, in tab order", () => {
    expect(visibleLibraryTabs(counts({ chaturanga: 2, chesscom: 5, lichess: 0 }))).toEqual([
      "chesscom",
      "chaturanga"
    ]);
    expect(visibleLibraryTabs(emptyTabCounts())).toEqual([]);
  });
});

describe("defaultLibraryTab", () => {
  const library = counts({ lichess: 4, chesscom: 5, imported: 1 });

  it("opens on the tab last chosen while it has games", () => {
    expect(
      defaultLibraryTab({ remembered: "imported", currentSource: "lichess", counts: library })
    ).toBe("imported");
  });

  it("else on the current game's tab, else the first tab with games", () => {
    expect(
      defaultLibraryTab({ remembered: null, currentSource: "chesscom", counts: library })
    ).toBe("chesscom");
    // The remembered tab has no games any more (e.g. its account's games were removed).
    expect(
      defaultLibraryTab({ remembered: "engine", currentSource: "pgn-import", counts: library })
    ).toBe("imported");
    // A new board's tab (Chaturanga) has no games: the first tab that has some.
    expect(defaultLibraryTab({ remembered: null, currentSource: "new", counts: library })).toBe(
      "lichess"
    );
    expect(defaultLibraryTab({ remembered: null, currentSource: null, counts: library })).toBe(
      "lichess"
    );
  });

  it("has no tab for an empty library", () => {
    expect(
      defaultLibraryTab({
        remembered: "lichess",
        currentSource: "lichess",
        counts: emptyTabCounts()
      })
    ).toBeNull();
  });
});
