/**
 * The move list's "Show all lines" choice, remembered on this machine (localStorage) like the
 * window layout: a way of reading the list, not a chess setting. A missing, unreadable or invalid
 * value falls back to folded lines.
 */

const SHOW_ALL_LINES_KEY = "chaturanga.moveList.showAllLines";

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
  try {
    return storage()?.getItem(SHOW_ALL_LINES_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveShowAllLines(showAll: boolean): void {
  try {
    storage()?.setItem(SHOW_ALL_LINES_KEY, showAll ? "1" : "0");
  } catch {
    // Full or blocked storage: the choice still applies for this session.
  }
}
