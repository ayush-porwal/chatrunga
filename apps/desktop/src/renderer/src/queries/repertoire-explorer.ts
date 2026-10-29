import { skipToken, useQuery } from "@tanstack/react-query";
import type { ExplorerMaiaInput } from "@chaturanga/shared/types/repertoire-explorer";
import { queryKeys } from "./api";

/**
 * Study's Explorer (docs/repertoire-games-and-practice.md §6.1–6.2) through
 * `window.chaturanga.repertoireExplorer`. The games at a position sit under the library's
 * ["games"] key, so a save, import or delete reads them again; while main is still indexing the
 * games, they are read again every few seconds. Maia's moves are asked per position and rating.
 */
const explorerKeys = {
  games: (repertoireId: string, fen: string) =>
    [...queryKeys.games, "explorer", repertoireId, fen] as const,
  maia: (input: ExplorerMaiaInput) =>
    ["repertoireExplorer", "maia", input.repertoireId, input.fen, input.rating, input.mode] as const
};

/** How often the counts are read again while the index is being built. */
const INDEXING_REFRESH_MS = 3_000;

/** The moves of the user's games at `fen` (null: nothing to ask), under the Insights filters. */
export function useExplorerGamesQuery(repertoireId: string, fen: string | null) {
  const api = window.chaturanga?.repertoireExplorer;
  return useQuery({
    queryKey: explorerKeys.games(repertoireId, fen ?? ""),
    queryFn: api && fen ? () => api.games({ repertoireId, fen }) : skipToken,
    refetchInterval: (query) => (query.state.data?.indexing ? INDEXING_REFRESH_MS : false)
  });
}

/**
 * Maia 3's likely moves (null: nothing to ask). Another rating or time control keeps the last
 * answer up while it loads; another position doesn't (its moves aren't this position's).
 */
export function useExplorerMaiaQuery(input: ExplorerMaiaInput | null) {
  const api = window.chaturanga?.repertoireExplorer;
  return useQuery({
    queryKey: input ? explorerKeys.maia(input) : ["repertoireExplorer", "maia", null],
    queryFn: api && input ? () => api.maiaMoves(input) : skipToken,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[3] === input?.fen ? previous : undefined,
    // An answer stands for its position and rating; "not installed" is asked again (after Settings).
    staleTime: (query) => (query.state.data?.installed === false ? 0 : Number.POSITIVE_INFINITY)
  });
}
