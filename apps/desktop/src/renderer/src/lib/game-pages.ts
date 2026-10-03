import type { GameListPage, GameSummary } from "@chaturanga/shared/types/chess";

/**
 * The games of the pages fetched so far, in order. A game saved between two page reads can move
 * (an import is dated by when it was played, so it may move down): it is listed once, where it
 * first appears, until the next re-read puts it in place.
 */
export function gamesOfPages(pages: readonly GameListPage[] | undefined): GameSummary[] {
  if (!pages) return [];
  const seen = new Set<string>();
  const games: GameSummary[] = [];
  for (const page of pages) {
    for (const game of page.items) {
      if (seen.has(game.id)) continue;
      seen.add(game.id);
      games.push(game);
    }
  }
  return games;
}
