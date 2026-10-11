/**
 * The move list's reading choice, remembered on this machine (localStorage) like the window
 * layout: whether every BEST line shows. A way of reading the list, not a chess setting. A
 * missing or unreadable value falls back to the default.
 */

import { readLocalPref, writeLocalPref } from "@/lib/local-prefs";

const SHOW_ALL_LINES_KEY = "chaturanga.moveList.showAllLines";

/** BEST lines start folded unless the list was last left showing them all. */
export function loadShowAllLines(): boolean {
  return readLocalPref(SHOW_ALL_LINES_KEY) === "1";
}

export function saveShowAllLines(showAll: boolean): void {
  writeLocalPref(SHOW_ALL_LINES_KEY, showAll ? "1" : "0");
}
