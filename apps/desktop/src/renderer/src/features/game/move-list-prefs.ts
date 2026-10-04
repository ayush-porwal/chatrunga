/**
 * The move list's reading choices, remembered on this machine (localStorage) like the window
 * layout: whether every BEST line shows, and Game review's Moves view (the list or the key
 * insights). Ways of reading the list, not chess settings. A missing, unreadable or invalid value
 * falls back to the default.
 */

const SHOW_ALL_LINES_KEY = "chaturanga.moveList.showAllLines";
const MOVES_VIEW_KEY = "chaturanga.review.movesView";

/** What Game review's Moves tab shows: the move list, or the key insights (the key moments). */
export type MovesView = "moves" | "key";

function read(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    storage()?.setItem(key, value);
  } catch {
    // Full or blocked storage: the choice still applies for this session.
  }
}

function storage(): Storage | null {
  // Storage access throws where it is blocked (a sandboxed or opaque origin).
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** BEST lines start folded unless the list was last left showing them all. */
export function loadShowAllLines(): boolean {
  return read(SHOW_ALL_LINES_KEY) === "1";
}

export function saveShowAllLines(showAll: boolean): void {
  write(SHOW_ALL_LINES_KEY, showAll ? "1" : "0");
}

/** The Moves tab opens on the move list unless it was last left on the key insights. */
export function loadMovesView(): MovesView {
  return read(MOVES_VIEW_KEY) === "key" ? "key" : "moves";
}

export function saveMovesView(view: MovesView): void {
  write(MOVES_VIEW_KEY, view);
}
