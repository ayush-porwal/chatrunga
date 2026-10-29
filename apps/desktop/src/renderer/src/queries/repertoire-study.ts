import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { RepertoireChapter } from "@chaturanga/shared/types/repertoire";
import { fetchPractisedElsewhere, repertoireKeys } from "./repertoire";

/*
 * Study's staged moves (docs/repertoire-games-and-practice.md §3): what the New moves card reads
 * about the repertoire beyond the open chapter.
 */

/**
 * The moves the repertoire's other chapters practise at `positionKeys` (UCI by position key), so
 * the New moves card can say which moves you already play there. Keyed under the repertoire's
 * decisions, so a write that changes them re-reads it.
 */
export function usePractisedElsewhereQuery(
  repertoireId: string,
  chapterId: string,
  positionKeys: readonly string[]
) {
  return useQuery({
    queryKey: ["repertoires", repertoireId, "decision", "elsewhere", chapterId, ...positionKeys],
    queryFn: () => fetchPractisedElsewhere(repertoireId, chapterId, [...positionKeys]),
    enabled: Boolean(positionKeys.length && window.chaturanga?.repertoires)
  });
}

/**
 * The opening a line (UCI moves from `rootFen`) reaches, as the bundled opening book names it:
 * what a New chapter for staged moves is called. Null when the book names none.
 */
export function useOpeningOfQuery(rootFen: string, moves: readonly string[]) {
  return useQuery({
    queryKey: ["opening-of", rootFen, ...moves],
    queryFn: async () =>
      (await window.chaturanga?.repertoires.openingOf({ rootFen, moves: [...moves] })) ?? null,
    enabled: Boolean(moves.length && window.chaturanga?.repertoires),
    staleTime: Infinity
  });
}

/** The chapters' data, the same array while none of them changes (useQueries' `combine`). */
function chapterData(
  results: readonly UseQueryResult<RepertoireChapter>[]
): (RepertoireChapter | undefined)[] {
  return results.map((result) => result.data);
}

/**
 * Several chapters of a repertoire (each through its chapter query's cache entry) as their data,
 * in `chapterIds`' order (undefined while one loads or can't be read): the choices panel's other
 * chapters reaching the selected position.
 */
export function useRepertoireChapterData(repertoireId: string, chapterIds: readonly string[]) {
  return useQueries({
    queries: chapterIds.map((chapterId) => ({
      queryKey: repertoireKeys.chapter(repertoireId, chapterId),
      queryFn: (): Promise<RepertoireChapter> => {
        const api = window.chaturanga?.repertoires;
        if (!api) throw new Error("Repertoires need the desktop app.");
        return api.getChapter({ repertoireId, chapterId });
      },
      enabled: Boolean(window.chaturanga?.repertoires),
      retry: false
    })),
    combine: chapterData
  });
}
