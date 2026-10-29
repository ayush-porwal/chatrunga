/**
 * Choose a game's list rules: which source it remembers for next time, when its Saved games
 * section has nothing to say, and what its refresh pulls in from the connected accounts.
 */
import { LIBRARY_TAB_LABELS, type LibraryTab } from "@chaturanga/shared/types/library";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { libraryFilterApplies, type LibraryFilter } from "../game/library-tab";

/** An account whose new games the refresh imports. */
export type SyncAccount = "lichess" | "chesscom";

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

/**
 * The accounts the refresh imports from, Lichess first: each one connected (Lichess while its
 * access holds, as Settings' Import now). None: no refresh.
 */
export function syncAccounts(connected: { lichess: boolean; chesscom: boolean }): SyncAccount[] {
  return (["lichess", "chesscom"] as const).filter((account) => connected[account]);
}

/** The refresh's name and tooltip: what it imports from. */
export function refreshGamesLabel(accounts: readonly SyncAccount[]): string {
  return `Refresh games from ${accounts.map((account) => LIBRARY_TAB_LABELS[account]).join(" and ")}`;
}

/**
 * Why each failed import failed, as Settings says it (the main process's message, else a
 * fallback), named by its account when more than one was imported from.
 */
export function syncFailures(
  accounts: readonly SyncAccount[],
  results: readonly PromiseSettledResult<unknown>[]
): string[] {
  return accounts.flatMap((account, index) => {
    const result = results[index];
    if (result.status !== "rejected") return [];
    const message = ipcErrorMessage(result.reason) || "Couldn’t import your games.";
    return [accounts.length > 1 ? `${LIBRARY_TAB_LABELS[account]}: ${message}` : message];
  });
}
