import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import type { PuzzleAttemptResult, RecordPuzzleAttemptInput } from "@chaturanga/shared/types/puzzle-rating";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { onPuzzleAttempt, type DecidedPuzzleAttempt } from "../stores/puzzle-store";

/**
 * The local puzzle rating through `window.chaturanga.puzzles` (main rates attempts and owns the
 * history). Everything sits under ["puzzles"], which recording an attempt invalidates. Empty in the
 * web preview (no `window.chaturanga`).
 */
export const puzzleKeys = {
  all: ["puzzles"] as const,
  summary: ["puzzles", "summary"] as const,
  history: ["puzzles", "history"] as const,
  themes: ["puzzles", "themes"] as const,
  failed: (sourceId: string | null) => ["puzzles", "failed", sourceId] as const
};

function api() {
  return window.chaturanga;
}

export function usePuzzleRatingSummaryQuery() {
  return useQuery({
    queryKey: puzzleKeys.summary,
    queryFn: async () => (await api()?.puzzles.ratingSummary()) ?? null
  });
}

export function usePuzzleRatingHistoryQuery() {
  return useQuery({
    queryKey: puzzleKeys.history,
    queryFn: async () => (await api()?.puzzles.ratingHistory()) ?? []
  });
}

export function usePuzzleThemeStatsQuery() {
  return useQuery({
    queryKey: puzzleKeys.themes,
    queryFn: async () => (await api()?.puzzles.themeStats()) ?? []
  });
}

/** Puzzles of a database source whose latest try failed (none without a source). */
export function useFailedPuzzlesQuery(sourceId: string | null) {
  return useQuery({
    queryKey: puzzleKeys.failed(sourceId),
    queryFn: async () => (sourceId ? ((await api()?.puzzles.failedPuzzles(sourceId)) ?? []) : []),
    enabled: sourceId !== null
  });
}

/**
 * The attempt's key for recording (main stores an attempt once per key): its own id, else the
 * puzzle and the moment it was shown.
 */
export function attemptKey(attempt: Pick<DecidedPuzzleAttempt, "id" | "puzzleId" | "startedAt">): string {
  return attempt.id || `${attempt.puzzleId}:${attempt.startedAt}`;
}

/**
 * Only a solve or a failure by the solver is recorded (and maybe rated): any other end of an
 * attempt (a puzzle whose data broke, say) is not the solver's result.
 */
export function isRecordable(attempt: { outcome: string }): attempt is { outcome: "solved" | "failed" } {
  return attempt.outcome === "solved" || attempt.outcome === "failed";
}

/** What main is told about a decided attempt. */
export function recordInput(attempt: DecidedPuzzleAttempt): RecordPuzzleAttemptInput {
  return {
    attemptId: attemptKey(attempt),
    puzzleId: attempt.puzzleId,
    databaseId: attempt.databaseId,
    sourceId: attempt.sourceId,
    outcome: attempt.outcome,
    puzzleRating: attempt.puzzleRating,
    puzzleRatingDeviation: attempt.puzzleRatingDeviation,
    themes: attempt.themes,
    wrongMoveCount: attempt.wrongMoves.length,
    solutionViewed: attempt.solutionViewed,
    startedAt: attempt.startedAt,
    // Set by the time an attempt is decided; the start is a safe stand-in for the type.
    decidedAt: attempt.decidedAt ?? attempt.startedAt,
    completedAt: attempt.completedAt
  };
}

export type PuzzleRecordState =
  | { status: "saving" }
  | { status: "saved"; result: PuzzleAttemptResult }
  | { status: "failed"; message: string };

/** Results of recent attempts, so the puzzle card can show the rating change. */
const KEPT_RESULTS = 20;

type PuzzleRecordStore = {
  byAttempt: Record<string, PuzzleRecordState>;
  set: (attemptId: string, state: PuzzleRecordState) => void;
};

export const usePuzzleRecordStore = create<PuzzleRecordStore>((set) => ({
  byAttempt: {},
  set: (attemptId, state) =>
    set((current) => {
      const entries = Object.entries({ ...current.byAttempt, [attemptId]: state });
      return { byAttempt: Object.fromEntries(entries.slice(-KEPT_RESULTS)) };
    })
}));

/**
 * Records each puzzle attempt once it is decided (main rates it), and again when a failed puzzle is
 * finished later (only its completion time is new). An attempt left while still pending is never
 * recorded. Mount once.
 */
export function usePuzzleAttemptRecording(): void {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      onPuzzleAttempt(({ kind, attempt }) => {
        const puzzles = api()?.puzzles;
        if (!puzzles || !isRecordable(attempt)) return;
        const key = attemptKey(attempt);
        const store = usePuzzleRecordStore.getState();
        if (kind === "completed") {
          // A clean solve was complete when decided (and recorded with its completion then).
          if (attempt.completedAt === attempt.decidedAt) return;
          void puzzles
            .recordAttempt(recordInput(attempt))
            .catch((error: unknown) => console.warn("puzzles.recordAttempt (completed) failed", error));
          return;
        }
        store.set(key, { status: "saving" });
        puzzles.recordAttempt(recordInput(attempt)).then(
          (result) => {
            usePuzzleRecordStore.getState().set(key, { status: "saved", result });
            void queryClient.invalidateQueries({ queryKey: puzzleKeys.all });
          },
          (error: unknown) => {
            console.warn("puzzles.recordAttempt failed", error);
            usePuzzleRecordStore.getState().set(key, { status: "failed", message: ipcErrorMessage(error) || "unknown error" });
          }
        );
      }),
    [queryClient]
  );
}
