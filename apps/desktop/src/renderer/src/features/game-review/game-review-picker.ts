/**
 * Choose a game's list rules: which source it remembers for next time, and when its Saved games
 * section has nothing to say.
 */
import type { LibraryTab } from "@chaturanga/shared/types/library";
import { libraryFilterApplies, type LibraryFilter } from "../game/library-tab";

/**
 * What a change of the filter leaves remembered: the source chosen, null for All games (Choose a
 * game opens on every game again), undefined while the source stays (only Reviewed changed).
 */
export function rememberedSource(
  previous: LibraryFilter,
  next: LibraryFilter
): LibraryTab | null | undefined {
  return next.tab === previous.tab ? undefined : next.tab;
}

/**
 * Whether the Saved games section is left out: the library holds no other game, nothing narrows
 * the list, and the current game is listed above it (its own empty state would only repeat that).
 */
export function savedGamesHidden(input: {
  hasGames: boolean;
  needle: string;
  filter: LibraryFilter;
  hasCurrent: boolean;
}): boolean {
  return (
    input.hasCurrent && !input.hasGames && !input.needle && !libraryFilterApplies(input.filter)
  );
}
