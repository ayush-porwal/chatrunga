/**
 * The source tab the library lists (the workspace's Library tab and Game review's Choose a game
 * share it): the last one chosen, remembered on this machine (localStorage) like the move list's
 * reading choices; until one is chosen, the current game's tab, else the first with games. A tab
 * shows only while the library has games from that source.
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
  type LibraryTab
} from "@chaturanga/shared/types/library";
import { isOneOf } from "@chaturanga/shared/types/guards";
import { useGameFacetsQuery } from "../../queries/api";

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
