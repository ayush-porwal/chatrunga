/**
 * The source tab Game review's Choose a game lists: the last one chosen there or in the workspace
 * Library's filter, remembered on this machine (localStorage) like the move list's reading
 * choices; until one is chosen, the current game's tab, else the first with games. A tab shows
 * only while the library has games from that source. Also the Library tab's filter (every source,
 * or one, and Reviewed), which starts from every game each time.
 */
import { create } from "zustand";
import type { GameSource } from "@chaturanga/shared/types/chess";
import {
  defaultLibraryTab,
  emptyTabCounts,
  LIBRARY_TAB_LABELS,
  LIBRARY_TABS,
  libraryTabOf,
  visibleLibraryTabs,
  type LibraryTab,
  type LibraryTabCounts
} from "@chaturanga/shared/types/library";
import { isOneOf } from "@chaturanga/shared/types/guards";
import { useGameFacetsQuery } from "../../queries/api";
import { recentGamesFilterOptions, type RecentGamesFilterOption } from "../play/recent-games";

const TAB_KEY = "chaturanga.library.tab";

function storage(): Storage | null {
  // Storage access throws where it is blocked (a sandboxed or opaque origin).
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The tab last chosen, or null (never chosen, or an unreadable value). */
export function loadLibraryTab(): LibraryTab | null {
  try {
    const value = storage()?.getItem(TAB_KEY) ?? null;
    return isOneOf(LIBRARY_TABS, value) ? value : null;
  } catch {
    return null;
  }
}

export function saveLibraryTab(tab: LibraryTab): void {
  try {
    storage()?.setItem(TAB_KEY, tab);
  } catch {
    // Full or blocked storage: the choice still applies for this session.
  }
}

/** The tab chosen last (null until one is), shared by every library list on screen. */
export const useLibraryTabStore = create<{
  remembered: LibraryTab | null;
  choose: (tab: LibraryTab) => void;
}>((set) => ({
  remembered: loadLibraryTab(),
  choose: (tab) => {
    saveLibraryTab(tab);
    set({ remembered: tab });
  }
}));

/** A game's source as the row's lead word ("Chess.com", "Imported", …). */
export function sourceLabel(source: GameSource): string {
  return LIBRARY_TAB_LABELS[libraryTabOf(source)];
}

/**
 * The library's tabs (with their counts) and the one listed. `tab` is null while the counts load
 * and when the library is empty.
 */
export function useLibraryTabs(currentSource: GameSource | null, excludeId: string | null) {
  const facets = useGameFacetsQuery(excludeId);
  const remembered = useLibraryTabStore((state) => state.remembered);
  const choose = useLibraryTabStore((state) => state.choose);
  const counts = facets.data?.tabs ?? emptyTabCounts();
  return {
    facets,
    counts,
    tabs: visibleLibraryTabs(counts),
    tab: defaultLibraryTab({ remembered, currentSource, counts }),
    choose
  };
}

/** What the Library tab lists: one source's games (`tab`; null for every game), only the reviewed ones or all. */
export type LibraryFilter = { tab: LibraryTab | null; reviewed: boolean };

export const DEFAULT_LIBRARY_FILTER: LibraryFilter = { tab: null, reviewed: false };

/**
 * Whether the filter narrows the list (anything but every source with Reviewed off): the filter
 * button's dot, shown whether its menu is open or not.
 */
export function libraryFilterApplies(filter: LibraryFilter): boolean {
  return (
    filter.tab !== DEFAULT_LIBRARY_FILTER.tab || filter.reviewed !== DEFAULT_LIBRARY_FILTER.reviewed
  );
}

/**
 * The Library's filter as it applies: the source chosen while the library still has games from it
 * (else every game), its menu's choices (All games, then each source with games, with counts), how
 * many games of the chosen source(s) are reviewed (Reviewed's count), and how many games it lists
 * (`total`, before any search: the Library tab's count).
 */
export function libraryFilterState(
  counts: LibraryTabCounts,
  chosen: LibraryFilter
): {
  filter: LibraryFilter;
  options: RecentGamesFilterOption[];
  reviewed: number;
  total: number;
} {
  const options = recentGamesFilterOptions(counts, null);
  const tab = chosen.tab && options.some((option) => option.tab === chosen.tab) ? chosen.tab : null;
  const tabs: readonly LibraryTab[] = tab ? [tab] : LIBRARY_TABS;
  const games = tabs.reduce((sum, each) => sum + counts[each].games, 0);
  const reviewed = tabs.reduce((sum, each) => sum + counts[each].reviewed, 0);
  return {
    filter: { tab, reviewed: chosen.reviewed },
    options,
    reviewed,
    total: chosen.reviewed ? reviewed : games
  };
}

/**
 * What the Library's list shows. The list waits for the counts (they settle the filter), so a
 * first read of them that fails is the list's error, with a retry: never skeleton rows forever. A
 * failed re-read keeps the counts it had.
 */
export function libraryListState(
  counts: { read: boolean; failed: boolean },
  games: { pending: boolean; failed: boolean }
): "counts-error" | "loading" | "error" | "ready" {
  if (!counts.read) return counts.failed ? "counts-error" : "loading";
  if (games.pending) return "loading";
  return games.failed ? "error" : "ready";
}
