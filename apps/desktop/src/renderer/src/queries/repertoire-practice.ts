import { useQuery } from "@tanstack/react-query";
import type { PracticeOverview } from "@chaturanga/shared/types/repertoire-practice";

/**
 * The practice home's reads (docs/repertoire-games-and-practice.md §2, §4). The overview's key
 * sits under the repertoire lists' (`['repertoires','list',…]`), so every write and progress event
 * that refreshes the hub lists refreshes it too.
 */
const practiceKeys = {
  overview: ["repertoires", "list", "practice-overview"] as const,
  bookOpenings: ["repertoires", "book-openings"] as const
};

/** Due counts change as time passes, with no write to announce it, so they're polled. */
const OVERVIEW_REFRESH_MS = 60_000;

const EMPTY_OVERVIEW: PracticeOverview = { repertoires: [], newToday: 0, newPerDay: 10 };

/** Each active repertoire's practice standing and today's new positions (the Practice tab, hub). */
export function usePracticeOverviewQuery({ enabled = true } = {}) {
  return useQuery({
    queryKey: practiceKeys.overview,
    queryFn: () => window.chaturanga?.repertoires.practiceOverview() ?? EMPTY_OVERVIEW,
    refetchInterval: OVERVIEW_REFRESH_MS,
    enabled
  });
}

/** The bundled book's named openings (Opening fields' suggestions); read once. */
export function useBookOpeningsQuery({ enabled = true } = {}) {
  return useQuery({
    queryKey: practiceKeys.bookOpenings,
    queryFn: () => window.chaturanga?.repertoires.bookOpenings() ?? [],
    staleTime: Infinity,
    enabled
  });
}
