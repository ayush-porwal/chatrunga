/** The game view's side-panel tabs (the engine sits atop Moves). */
export type SideTab = "notation" | "library";

/** The puzzle on this board: none, still being solved (`locked`), or solved / failed (`open`). */
export type PuzzleTabs = "none" | "locked" | "open";

/**
 * A side tab from a recorded value: the Engine tab of older builds (merged into Moves) and
 * anything unknown read as Moves.
 */
export function sideTabFrom(value: unknown): SideTab {
  return value === "library" ? "library" : "notation";
}

/** The tab shown: a puzzle never shows Library. */
export function availableSideTab(tab: SideTab, puzzle: PuzzleTabs): SideTab {
  return puzzle === "none" ? tab : "notation";
}

/** Whether the Moves tab shows the engine: not while a puzzle is being solved (it would give the answer away). */
export function showsEngine(puzzle: PuzzleTabs): boolean {
  return puzzle !== "locked";
}
