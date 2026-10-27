import { useEffect } from "react";
import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient
} from "@tanstack/react-query";
import type { ChaturangaApi } from "@chaturanga/shared/ipc/chaturanga-api";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import type {
  GamePuzzleFilter,
  GamePuzzleQuery,
  GamePuzzleQueueStatus,
  GamePuzzleSettings
} from "@chaturanga/shared/types/game-puzzles";
import type { NextPuzzleInput } from "../app/puzzle-session-controller";
import { gamePuzzleSample } from "../features/puzzles/game-puzzle-set";

/**
 * Puzzles from the user's games through `window.chaturanga.gamePuzzles` (main runs the queue and
 * stores the puzzles). Everything sits under ["gamePuzzles"]; the queue's status is kept live by
 * `onGenerationProgress` (useGamePuzzleProgressSubscription), and each game it finishes reads the
 * counts again. Nothing is available in the web preview (no `window.chaturanga`).
 */
const gamePuzzleKeys = {
  summary: ["gamePuzzles", "summary"] as const,
  status: ["gamePuzzles", "status"] as const,
  lastSettings: ["gamePuzzles", "lastSettings"] as const,
  counts: ["gamePuzzles", "count"] as const,
  count: (settings: GamePuzzleSettings) => ["gamePuzzles", "count", settings] as const,
  lists: ["gamePuzzles", "list"] as const,
  list: (filter: GamePuzzleFilter) => ["gamePuzzles", "list", filter] as const
};

function gamePuzzlesApi(): ChaturangaApi["gamePuzzles"] | undefined {
  return window.chaturanga?.gamePuzzles;
}

function requireGamePuzzlesApi(): ChaturangaApi["gamePuzzles"] {
  const api = gamePuzzlesApi();
  if (!api) throw new Error("Puzzles from your games need the desktop app.");
  return api;
}

/** Reads the counts again (a game finished, an attempt was scheduled, a generation started). */
export function invalidateGamePuzzleCounts(queryClient: QueryClient): void {
  for (const queryKey of [gamePuzzleKeys.summary, gamePuzzleKeys.lists, gamePuzzleKeys.counts])
    void queryClient.invalidateQueries({ queryKey });
}

/** The "My games" card: games per source, processed, puzzles found and due, engine and Maia. */
export function useGamePuzzleSummaryQuery() {
  return useQuery({
    queryKey: gamePuzzleKeys.summary,
    queryFn: () => requireGamePuzzlesApi().summary(),
    enabled: Boolean(gamePuzzlesApi())
  });
}

/** The queue as main last reported it (kept live by useGamePuzzleProgressSubscription). */
export function useGamePuzzleStatusQuery() {
  return useQuery({
    queryKey: gamePuzzleKeys.status,
    queryFn: () => requireGamePuzzlesApi().status(),
    enabled: Boolean(gamePuzzlesApi()),
    staleTime: Number.POSITIVE_INFINITY
  });
}

/**
 * Keeps the queue's status live from `onGenerationProgress`, and reads the counts again whenever
 * a game finishes. Mount once.
 */
export function useGamePuzzleProgressSubscription(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const unsubscribe = gamePuzzlesApi()?.onGenerationProgress((event) => {
      queryClient.setQueryData(gamePuzzleKeys.status, event.status);
      if (event.finished) invalidateGamePuzzleCounts(queryClient);
    });
    return () => unsubscribe?.();
  }, [queryClient]);
}

/** The Generate puzzles dialog's last settings (the defaults when it was never used). */
export function useGamePuzzleLastSettingsQuery() {
  return useQuery({
    queryKey: gamePuzzleKeys.lastSettings,
    queryFn: () => requireGamePuzzlesApi().lastSettings(),
    enabled: Boolean(gamePuzzlesApi()),
    staleTime: Number.POSITIVE_INFINITY
  });
}

/** How many games `settings` would queue (null: nothing to ask yet). The last count stays up meanwhile. */
export function useGamePuzzleCountQuery(settings: GamePuzzleSettings | null) {
  const api = gamePuzzlesApi();
  return useQuery({
    queryKey: settings ? gamePuzzleKeys.count(settings) : gamePuzzleKeys.counts,
    queryFn: settings && api ? () => api.countGames(settings) : skipToken,
    placeholderData: keepPreviousData
  });
}

/** The "From my games" set's size with `filter`: how many puzzles match, and how many are due. */
export function useGamePuzzleListQuery(filter: GamePuzzleFilter, { enabled = true } = {}) {
  return useQuery({
    queryKey: gamePuzzleKeys.list(filter),
    queryFn: async () => {
      const { total, due } = await requireGamePuzzlesApi().list({ ...filter, limit: 1 });
      return { total, due };
    },
    enabled: enabled && Boolean(gamePuzzlesApi())
  });
}

/** Queues the games `settings` match; they are also remembered as the dialog's last settings. */
export function useStartGamePuzzlesMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: GamePuzzleSettings) => requireGamePuzzlesApi().start(settings),
    onSuccess: (status, settings) => {
      queryClient.setQueryData(gamePuzzleKeys.status, status);
      queryClient.setQueryData(gamePuzzleKeys.lastSettings, settings);
      invalidateGamePuzzleCounts(queryClient);
    }
  });
}

/** Pause, Resume or Cancel the queue. */
export function useGamePuzzleQueueMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: "pause" | "resume" | "cancel"): Promise<GamePuzzleQueueStatus> =>
      requireGamePuzzlesApi()[action](),
    onSuccess: (status) => queryClient.setQueryData(gamePuzzleKeys.status, status)
  });
}

/** Puzzles left out at most while drawing, when a drawn one can't be played (broken data). */
const BROKEN_SKIPS = 5;

/**
 * The "From my games" set's next puzzle as the session plays it. A puzzle whose data can't be
 * played is skipped (a few at most); none left is an error the page and the puzzle card show.
 */
export async function drawGamePuzzle(
  query: GamePuzzleQuery,
  api: Pick<ChaturangaApi["gamePuzzles"], "next"> = requireGamePuzzlesApi()
): Promise<PuzzleSample> {
  const excludeIds = [...(query.excludeIds ?? [])];
  for (let tries = 0; tries <= BROKEN_SKIPS; tries += 1) {
    const puzzle = await api.next({ ...query, excludeIds: [...excludeIds] });
    if (!puzzle) break;
    const sample = gamePuzzleSample(puzzle);
    if (sample) return sample;
    excludeIds.push(puzzle.id);
  }
  throw new Error("No puzzles from your games match these filters.");
}

/** The set's next puzzle: a database's sampler, or the "From my games" queue (Next puzzle). */
export function useNextPuzzleMutation() {
  return useMutation({
    mutationFn: (input: NextPuzzleInput): Promise<PuzzleSample> => {
      if ("gamePuzzles" in input) return drawGamePuzzle(input.gamePuzzles);
      const api = window.chaturanga;
      if (!api) throw new Error("Desktop API is unavailable in this environment.");
      return api.databases.samplePuzzle(input);
    }
  });
}

/** Starts the "From my games" set (the Puzzles page's Start). */
export function useDrawGamePuzzleMutation() {
  return useMutation({ mutationFn: (query: GamePuzzleQuery) => drawGamePuzzle(query) });
}
