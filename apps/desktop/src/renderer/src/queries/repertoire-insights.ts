import { useEffect } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient
} from "@tanstack/react-query";
import type { ChaturangaApi } from "@chaturanga/shared/ipc/chaturanga-api";
import type {
  InsightsComparerStatus,
  InsightsFilters,
  InsightsGamesQuery
} from "@chaturanga/shared/types/repertoire-insights";
import { queryKeys } from "./api";

/**
 * Repertoire Insights (docs/repertoire-games-and-practice.md §5) through
 * `window.chaturanga.repertoireInsights`: main compares the games and builds the report. Every key
 * is under `['repertoireInsights']`; the comparer's progress events keep its status live, and each
 * chunk it writes (and its end) reads the report, the games list and the weak-spots banner again.
 * Nothing is available in the web preview.
 */
const insightsKeys = {
  all: ["repertoireInsights"] as const,
  results: ["repertoireInsights", "results"] as const,
  report: (lineMove: number) => ["repertoireInsights", "results", "report", lineMove] as const,
  games: (query: InsightsGamesQuery) => ["repertoireInsights", "results", "games", query] as const,
  weakSpots: ["repertoireInsights", "results", "weakSpots"] as const,
  filters: ["repertoireInsights", "filters"] as const,
  status: ["repertoireInsights", "status"] as const
};

function insightsApi(): ChaturangaApi["repertoireInsights"] | undefined {
  return window.chaturanga?.repertoireInsights;
}

function requireInsightsApi(): ChaturangaApi["repertoireInsights"] {
  const api = insightsApi();
  if (!api) throw new Error("Insights need the desktop app.");
  return api;
}

function invalidateResults(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: insightsKeys.results });
}

/**
 * Keeps the comparer's status live, and reads the results again as it writes them. Each Insights
 * hook mounts it.
 */
function useInsightsEvents(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const unsubscribe = insightsApi()?.onProgress((status) => {
      const previous = queryClient.getQueryData<InsightsComparerStatus>(insightsKeys.status);
      queryClient.setQueryData(insightsKeys.status, status);
      // Each chunk's results, and the pass's end.
      if (status.done !== previous?.done || status.running !== previous.running)
        invalidateResults(queryClient);
    });
    return () => unsubscribe?.();
  }, [queryClient]);
}

/** The comparer as main last reported it. */
export function useInsightsStatusQuery() {
  useInsightsEvents();
  return useQuery({
    queryKey: insightsKeys.status,
    queryFn: () => requireInsightsApi().status(),
    enabled: Boolean(insightsApi()),
    staleTime: Number.POSITIVE_INFINITY
  });
}

/** The report under the saved filters, with score by line at `lineMove` (the last one stays up meanwhile). */
export function useInsightsReportQuery(lineMove: number) {
  useInsightsEvents();
  return useQuery({
    queryKey: insightsKeys.report(lineMove),
    queryFn: () => requireInsightsApi().report({ lineMove }),
    enabled: Boolean(insightsApi()),
    placeholderData: keepPreviousData
  });
}

/** A page of the games list (the last page stays up while the next loads). */
export function useInsightsGamesQuery(query: InsightsGamesQuery) {
  useInsightsEvents();
  return useQuery({
    queryKey: insightsKeys.games(query),
    queryFn: () => requireInsightsApi().games(query),
    enabled: Boolean(insightsApi()),
    placeholderData: keepPreviousData
  });
}

/** The Practice tab's weak-spots banner. */
export function useInsightsWeakSpotsQuery() {
  useInsightsEvents();
  return useQuery({
    queryKey: insightsKeys.weakSpots,
    queryFn: () => requireInsightsApi().weakSpots(),
    enabled: Boolean(insightsApi())
  });
}

export function useInsightsFiltersQuery() {
  return useQuery({
    queryKey: insightsKeys.filters,
    queryFn: () => requireInsightsApi().filters(),
    enabled: Boolean(insightsApi()),
    staleTime: Number.POSITIVE_INFINITY
  });
}

/**
 * Saves the filters: shown at once, then everything read under them is read again (the report,
 * the games list, the banner, and the Study explorer's games).
 */
export function useSetInsightsFiltersMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (filters: InsightsFilters) => requireInsightsApi().setFilters(filters),
    onMutate: (filters) => {
      queryClient.setQueryData(insightsKeys.filters, filters);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: insightsKeys.filters });
      invalidateResults(queryClient);
      // The Study explorer lists the user's games under these filters.
      void queryClient.invalidateQueries({ queryKey: [...queryKeys.games, "explorer"] });
    }
  });
}
