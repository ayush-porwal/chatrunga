/** The game view's side-panel tabs. */
export type SideTab = "notation" | "engine" | "library";

/** The puzzle on this board: none, still being solved (`locked`), or solved / failed (`open`). */
export type PuzzleTabs = "none" | "locked" | "open";

/** The tab shown: a puzzle never shows Library, nor Engine while it is locked. */
export function availableSideTab(tab: SideTab, puzzle: PuzzleTabs): SideTab {
  if (puzzle === "none") return tab;
  if (tab === "library" || (tab === "engine" && puzzle === "locked")) return "notation";
  return tab;
}
