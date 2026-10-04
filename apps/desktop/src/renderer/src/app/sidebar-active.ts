import type { GameMode, GameSource } from "@chaturanga/shared/types/chess";
import type { AppView } from "./AppPages";

/** Which sidebar destinations show as the current one (pressed). */
export type SidebarActive = {
  home: boolean;
  analyze: boolean;
  play: boolean;
  review: boolean;
  repertoire: boolean;
  puzzles: boolean;
  databases: boolean;
  settings: boolean;
};

const repertoireViews: ReadonlySet<AppView> = new Set([
  "repertoire-hub",
  "repertoire-study",
  "repertoire-practice"
]);

/**
 * The game view is the Analyze page unless its board is a game being played (an engine or a
 * Lichess game) or a puzzle, whether or not the Engine tab's Analysis switch is on.
 */
export function onAnalyzePage(view: AppView, mode: GameMode, source: GameSource): boolean {
  return view === "game" && (mode === "freeplay" || mode === "analysis") && source !== "puzzle";
}

/** The sidebar's current destination; Game review also while its picker is open. */
export function sidebarActiveFor({
  view,
  gameMode,
  gameSource,
  reviewPickerOpen
}: {
  view: AppView;
  gameMode: GameMode;
  gameSource: GameSource;
  reviewPickerOpen: boolean;
}): SidebarActive {
  return {
    home: view === "home",
    analyze: onAnalyzePage(view, gameMode, gameSource),
    review: view === "game-review" || reviewPickerOpen,
    repertoire: repertoireViews.has(view),
    play: view === "play",
    puzzles: view === "puzzles",
    databases: view === "databases",
    settings: view === "settings"
  };
}
