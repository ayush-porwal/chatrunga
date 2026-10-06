/**
 * The library's source tabs (the Library tab and Game review's Choose a game): every game shows
 * under exactly one, by where it came from. Games made in the app (a free board, an analysis, a
 * puzzle) are Chaturanga's.
 */
import type { GameSource } from "./chess";

export const LIBRARY_TABS = ["lichess", "chesscom", "imported", "engine", "chaturanga"] as const;
export type LibraryTab = (typeof LIBRARY_TABS)[number];

export const LIBRARY_TAB_LABELS: Record<LibraryTab, string> = {
  lichess: "Lichess",
  chesscom: "Chess.com",
  imported: "Imported",
  engine: "Engine",
  chaturanga: "Chaturanga"
};

/** Each source's tab. A Record over every source, so a new source doesn't compile until it has one. */
const TAB_OF_SOURCE: Record<GameSource, LibraryTab> = {
  lichess: "lichess",
  chesscom: "chesscom",
  "pgn-import": "imported",
  "engine-game": "engine",
  new: "chaturanga",
  analysis: "chaturanga",
  puzzle: "chaturanga"
};

/** Whether a value names a game source (e.g. one read over IPC). */
export function isGameSource(value: unknown): value is GameSource {
  return typeof value === "string" && Object.hasOwn(TAB_OF_SOURCE, value);
}

/** Every game source. */
export const GAME_SOURCES: readonly GameSource[] = Object.keys(TAB_OF_SOURCE).filter(isGameSource);

/** The tab a game of `source` shows under. */
export function libraryTabOf(source: GameSource): LibraryTab {
  return TAB_OF_SOURCE[source];
}

/** The sources a tab shows (each source is in exactly one tab). */
export function sourcesOfTab(tab: LibraryTab): GameSource[] {
  return GAME_SOURCES.filter((source) => TAB_OF_SOURCE[source] === tab);
}

/** How many library games a tab holds, and how many of them have a saved analysis. */
export type LibraryTabCount = { games: number; reviewed: number };
export type LibraryTabCounts = Record<LibraryTab, LibraryTabCount>;

export function emptyTabCounts(): LibraryTabCounts {
  return {
    lichess: { games: 0, reviewed: 0 },
    chesscom: { games: 0, reviewed: 0 },
    imported: { games: 0, reviewed: 0 },
    engine: { games: 0, reviewed: 0 },
    chaturanga: { games: 0, reviewed: 0 }
  };
}

/** The tabs to show: those with games, in tab order. */
export function visibleLibraryTabs(counts: LibraryTabCounts): LibraryTab[] {
  return LIBRARY_TABS.filter((tab) => counts[tab].games > 0);
}

/**
 * The tab a list opens on: the one last chosen, while it has games; else the current game's tab,
 * while it has games; else the first tab with games. Null when the library is empty.
 */
export function defaultLibraryTab(input: {
  remembered: LibraryTab | null;
  currentSource: GameSource | null;
  counts: LibraryTabCounts;
}): LibraryTab | null {
  const visible = visibleLibraryTabs(input.counts);
  if (input.remembered && visible.includes(input.remembered)) return input.remembered;
  const current = input.currentSource ? libraryTabOf(input.currentSource) : null;
  if (current && visible.includes(current)) return current;
  return visible[0] ?? null;
}
