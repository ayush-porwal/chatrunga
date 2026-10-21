import { useQuery } from "@tanstack/react-query";
import { engineDisplayName } from "@chaturanga/shared/engine/managed";
import type { Color, GameSummary, MoveNode, SavedGame } from "@chaturanga/shared/types/chess";
import {
  LIBRARY_TAB_LABELS,
  LIBRARY_TABS,
  type LibraryTab,
  type LibraryTabCounts
} from "@chaturanga/shared/types/library";
import { useLatestGamesQuery } from "../../queries/api";
import { sideNamed } from "../game-review/review-side";
import { RECENT_GAMES_FETCH } from "./play-layout";

/** Rows the Recent games table shows at first, and adds on each "Load more games". */
export const RECENT_GAMES_ROWS = 10;

/** How long typing pauses before the library is searched (Recent games, the Library tab). */
export const GAME_SEARCH_DEBOUNCE_MS = 200;

/** The newest games, read once for the table and the page (one query key, see play-layout.ts). */
export function useRecentGamesQuery() {
  return useLatestGamesQuery(RECENT_GAMES_FETCH);
}

/** The table's rows: newest first, without the game the In progress card shows. */
export function recentRows(
  games: readonly GameSummary[],
  excludeGameId: string | null,
  limit = RECENT_GAMES_ROWS
): GameSummary[] {
  return games.filter((game) => game.id !== excludeGameId).slice(0, limit);
}

/** One choice of the Recent games filter: every game (`tab` null) or one source's. */
export type RecentGamesFilterOption = { tab: LibraryTab | null; label: string; count: number };

/**
 * The filter's choices: "All games", then each source with games, in tab order. The counts leave
 * out the game the In progress card shows (`excludedTab` is its source's tab; null when there is
 * none, or it isn't known yet), as the table does.
 */
export function recentGamesFilterOptions(
  counts: LibraryTabCounts,
  excludedTab: LibraryTab | null
): RecentGamesFilterOption[] {
  const sources = LIBRARY_TABS.map((tab) => ({
    tab,
    label: LIBRARY_TAB_LABELS[tab],
    count: Math.max(0, counts[tab].games - (tab === excludedTab ? 1 : 0))
  })).filter((option) => option.count > 0);
  const all = sources.reduce((total, option) => total + option.count, 0);
  return [{ tab: null, label: "All games", count: all }, ...sources];
}

/**
 * The source the table lists: the one chosen while the filter offers it (it is offered while the
 * library holds games of two sources or more), else every game.
 */
export function recentGamesFilterTab(
  options: readonly RecentGamesFilterOption[],
  chosen: LibraryTab | null
): LibraryTab | null {
  return options.length > 2 && options.some((option) => option.tab === chosen) ? chosen : null;
}

export type Score = "1" | "0" | "½";

/** Each side's score once the game is decided; null while it is in progress (or unknown). */
export function scoresFor(result: string | null): Record<Color, Score> | null {
  switch (result) {
    case "1-0":
      return { white: "1", black: "0" };
    case "0-1":
      return { white: "0", black: "1" };
    case "1/2-1/2":
      return { white: "½", black: "½" };
    default:
      return null;
  }
}

/** A player's name as the table shows it: the engine's plain name, "White" / "Black" when unnamed. */
export function playerName(game: Pick<GameSummary, Color>, color: Color): string {
  const name = engineDisplayName(game[color]?.trim() ?? "");
  return name || (color === "white" ? "White" : "Black");
}

/**
 * The side the user played: the "You" side of an engine game, else the side named after a
 * connected account (Lichess, Chess.com); null when neither tells (someone else's game).
 */
export function yourSideOf(
  game: Pick<GameSummary, Color>,
  usernames: readonly (string | null)[]
): Color | null {
  const you = (color: Color) => game[color]?.trim() === "You";
  if (you("white") !== you("black")) return you("white") ? "white" : "black";
  for (const username of usernames) {
    const side = sideNamed(game, username);
    if (side) return side;
  }
  return null;
}

/** The side the thumbnail shows at the bottom: the side the user played, else White. */
export function userSide(
  game: Pick<GameSummary, Color>,
  usernames: readonly (string | null)[]
): Color {
  return yourSideOf(game, usernames) ?? "white";
}

/**
 * The main line's length in full moves (a move by each side counts once) and the move on the board
 * (its UCI, for the last-move tint).
 */
export function savedGameFacts(
  saved: Pick<SavedGame, "moveTree" | "currentNodeId" | "currentFen">
): { moves: number; lastMoveUci: string | null } {
  const byId = new Map<string, MoveNode>(saved.moveTree.map((node) => [node.id, node]));
  let node = saved.moveTree.find((item) => item.parentId === null);
  let plies = 0;
  while (node?.children[0]) {
    node = byId.get(node.children[0]);
    if (node) plies += 1;
  }
  const current = saved.currentNodeId
    ? byId.get(saved.currentNodeId)
    : saved.moveTree.find((item) => item.fenAfter === saved.currentFen);
  return { moves: Math.ceil(plies / 2), lastMoveUci: current?.uci ?? null };
}

/** What the newest analysis found, for the Open review tooltip ("3 errors found"). */
export function reviewSummary(saved: Pick<SavedGame, "review">): string {
  const summary = saved.review?.summary;
  if (!summary) return "Reviewed";
  const errors = summary.blunders + summary.mistakes;
  if (errors) return `${errors} ${errors === 1 ? "error" : "errors"} found`;
  const { inaccuracies } = summary;
  return inaccuracies
    ? `${inaccuracies} ${inaccuracies === 1 ? "inaccuracy" : "inaccuracies"}, no errors`
    : "No errors found";
}

/**
 * One saved game with its moves (move count, last move), none for a null `id`; under ["games"], so
 * a save refreshes it.
 */
export function useSavedGameDetail(id: string | null) {
  return useQuery({
    queryKey: ["games", "detail", id ?? ""],
    queryFn: async (): Promise<SavedGame | null> =>
      id ? ((await window.chaturanga?.games.get(id)) ?? null) : null,
    enabled: id !== null,
    staleTime: 5_000
  });
}
