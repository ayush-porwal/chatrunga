import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import type { PuzzleAttemptResult, RecordPuzzleAttemptInput } from "@chaturanga/shared/types/puzzle-rating";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { onPuzzleAttempt, type DecidedPuzzleAttempt, type PuzzleAttemptEvent } from "../stores/puzzle-store";

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

/** Where an attempt is recorded, and what a recorded one changes. */
export type AttemptRecorder = {
  recordAttempt: (input: RecordPuzzleAttemptInput) => Promise<PuzzleAttemptResult>;
  /** Called after every successful write: the rating, history and failed puzzles may have changed. */
  onRecorded: () => void;
};

/**
 * Records a decided attempt, and again when a failed puzzle is finished later (main fills in what
 * is new). Any write that succeeds shows its result on the card: a finished puzzle whose decided
 * write failed is stored (and rated) by the later one, so the card no longer says it wasn't saved.
 * Settles once the write has; nothing to record settles at once.
 */
export async function recordAttemptEvent({ kind, attempt }: PuzzleAttemptEvent, recorder: AttemptRecorder): Promise<void> {
  if (!isRecordable(attempt)) return;
  // A clean solve was complete when decided (and recorded with its completion then).
  if (kind === "completed" && attempt.completedAt === attempt.decidedAt) return;
  const key = attemptKey(attempt);
  const store = usePuzzleRecordStore.getState();
  if (kind === "decided") store.set(key, { status: "saving" });
  try {
    const result = await recorder.recordAttempt(recordInput(attempt));
    store.set(key, { status: "saved", result });
    recorder.onRecorded();
  } catch (error) {
    console.warn(`puzzles.recordAttempt (${kind}) failed`, error);
    // A completion that failed leaves what the decided write showed.
    if (kind === "decided") store.set(key, { status: "failed", message: ipcErrorMessage(error) || "unknown error" });
  }
}

/** Records each puzzle attempt as it is decided and completed (see recordAttemptEvent). Mount once. */
export function usePuzzleAttemptRecording(): void {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      onPuzzleAttempt((event) => {
        const puzzles = api()?.puzzles;
        if (!puzzles) return;
        void recordAttemptEvent(event, {
          recordAttempt: (input) => puzzles.recordAttempt(input),
          onRecorded: () => void queryClient.invalidateQueries({ queryKey: puzzleKeys.all })
        });
      }),
    [queryClient]
  );
}
