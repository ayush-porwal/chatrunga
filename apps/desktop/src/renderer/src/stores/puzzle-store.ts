import { create } from "zustand";
import type { PuzzleSample } from "@chaturanga/shared/types/database";

export type PuzzleFeedbackKind = "idle" | "correct" | "wrong" | "complete";

/**
 * How the puzzle went, as Lichess scores it: `failed` from the first wrong move or from opening
 * the solution before it is solved (it stays failed even when finished afterwards), `solved` when
 * the last move is found with neither. `pending` until one of those happens.
 */
export type PuzzleOutcome = "pending" | "solved" | "failed";

/** A move the solver tried that isn't the solution's (it is refused, never played). */
export type PuzzleWrongMove = {
  /** The solution move it was played instead of (index into `solutionMoves`). */
  solutionIndex: number;
  /** The position it was played from. */
  fen: string;
  uci: string;
  san: string;
  /** The solution's move there (UCI). */
  expectedUci: string;
  at: number;
};

/**
 * One try at the active puzzle, from the moment it is shown: what a puzzle rating (Glicko-2) and an
 * explanation of the mistake need. The outcome is the store's `outcome`.
 */
export type PuzzleAttempt = {
  puzzleId: string;
  databaseId: string;
  sourceId: string;
  /** The puzzle's own rating (Lichess sets; null for position sets). */
  puzzleRating: number | null;
  /** In the order they were tried. */
  wrongMoves: PuzzleWrongMove[];
  /** The solution was opened before the puzzle was finished. */
  solutionViewed: boolean;
  startedAt: number;
  /** When the outcome left `pending`; null while it is pending. */
  decidedAt: number | null;
  /** When the last solution move was played; null while unfinished. */
  completedAt: number | null;
};

/** An attempt whose outcome is known, as the attempt events carry it. */
export type DecidedPuzzleAttempt = PuzzleAttempt & { outcome: Exclude<PuzzleOutcome, "pending"> };

/**
 * `decided`: the outcome left `pending` (once per attempt — the first wrong move, the solution
 * opened, or a clean solve). `completed`: the last solution move was played (a clean solve sends
 * `decided` then `completed`; a failed puzzle finished later sends `completed` then).
 */
export type PuzzleAttemptEvent = { kind: "decided" | "completed"; attempt: DecidedPuzzleAttempt };

type PuzzleStore = {
  activePuzzle: PuzzleSample | null;
  solutionIndex: number;
  feedbackKind: PuzzleFeedbackKind;
  feedback: string | null;
  lastExpectedMove: string | null;
  outcome: PuzzleOutcome;
  /** The try at `activePuzzle` (null without one). */
  attempt: PuzzleAttempt | null;
  setActivePuzzle: (puzzle: PuzzleSample | null) => void;
  advanceSolution: (count: number, feedback?: string) => void;
  /** A wrong try at the next solution move from `fen`: recorded, and the puzzle is failed. */
  markWrongMove: (input: { uci: string; san: string; fen: string; expected: string }) => void;
  /** The scripted reply couldn't be played (bad puzzle data): said so, without failing the solver. */
  markReplyFailed: (expected: string) => void;
  /** The solution was opened: fails a puzzle not yet decided; nothing once it is finished. */
  revealSolution: () => void;
  markComplete: () => void;
  reset: () => void;
};

const listeners = new Set<(event: PuzzleAttemptEvent) => void>();

/**
 * Subscribes to attempts being decided and completed — the one place a finished attempt is
 * reported (to save it, rate it, or explain it). Returns the unsubscribe.
 */
export function onPuzzleAttempt(listener: (event: PuzzleAttemptEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(kind: PuzzleAttemptEvent["kind"], state: Pick<PuzzleStore, "attempt" | "outcome">): void {
  if (!state.attempt || state.outcome === "pending") return;
  const event: PuzzleAttemptEvent = { kind, attempt: { ...state.attempt, outcome: state.outcome } };
  for (const listener of [...listeners]) listener(event);
}

/** The solver's first wrong move (what an explanation starts from), or null. */
export function selectFirstWrongMove(state: Pick<PuzzleStore, "attempt">): PuzzleWrongMove | null {
  return state.attempt?.wrongMoves[0] ?? null;
}

function newAttempt(puzzle: PuzzleSample): PuzzleAttempt {
  return {
    puzzleId: puzzle.id,
    databaseId: puzzle.databaseId,
    sourceId: puzzle.sourceId,
    puzzleRating: puzzle.rating ?? null,
    wrongMoves: [],
    solutionViewed: false,
    startedAt: Date.now(),
    decidedAt: null,
    completedAt: null
  };
}

const empty = {
  activePuzzle: null,
  solutionIndex: 0,
  feedbackKind: "idle",
  feedback: null,
  lastExpectedMove: null,
  outcome: "pending",
  attempt: null
} satisfies Partial<PuzzleStore>;

export const usePuzzleStore = create<PuzzleStore>((set, get) => ({
  ...empty,
  setActivePuzzle: (activePuzzle) =>
    set({
      ...empty,
      activePuzzle,
      feedback: activePuzzle ? "Find the best move." : null,
      attempt: activePuzzle ? newAttempt(activePuzzle) : null
    }),
  advanceSolution: (count, feedback) =>
    set((state) => ({
      solutionIndex: Math.min(
        state.activePuzzle?.solutionMoves.length ?? 0,
        state.solutionIndex + count
      ),
      feedbackKind: "correct",
      feedback: feedback ?? "Correct.",
      lastExpectedMove: null
    })),
  markWrongMove: ({ uci, san, fen, expected }) => {
    const { attempt, outcome, solutionIndex } = get();
    const now = Date.now();
    const deciding = Boolean(attempt) && outcome === "pending";
    set({
      feedbackKind: "wrong",
      feedback: `Not quite. ${san} is not the tactic.`,
      lastExpectedMove: expected,
      ...(attempt
        ? {
            outcome: "failed",
            attempt: {
              ...attempt,
              wrongMoves: [...attempt.wrongMoves, { solutionIndex, fen, uci, san, expectedUci: expected, at: now }],
              decidedAt: attempt.decidedAt ?? now
            }
          }
        : {})
    });
    if (deciding) emit("decided", get());
  },
  markReplyFailed: (expected) =>
    set({
      feedbackKind: "wrong",
      feedback: "The puzzle's reply couldn't be played.",
      lastExpectedMove: expected
    }),
  revealSolution: () => {
    const { attempt, outcome } = get();
    if (!attempt || attempt.completedAt !== null || attempt.solutionViewed) return;
    const deciding = outcome === "pending";
    set({
      outcome: "failed",
      attempt: { ...attempt, solutionViewed: true, decidedAt: attempt.decidedAt ?? Date.now() }
    });
    if (deciding) emit("decided", get());
  },
  markComplete: () => {
    const { attempt, outcome } = get();
    const now = Date.now();
    const deciding = Boolean(attempt) && outcome === "pending";
    const completing = Boolean(attempt) && attempt?.completedAt === null;
    set((state) => ({
      solutionIndex: state.activePuzzle?.solutionMoves.length ?? state.solutionIndex,
      feedbackKind: "complete",
      feedback: state.outcome === "failed" ? "Puzzle complete." : "Puzzle solved.",
      lastExpectedMove: null,
      ...(attempt
        ? {
            outcome: deciding ? "solved" : state.outcome,
            attempt: { ...attempt, decidedAt: attempt.decidedAt ?? now, completedAt: attempt.completedAt ?? now }
          }
        : {})
    }));
    if (deciding) emit("decided", get());
    if (completing) emit("completed", get());
  },
  reset: () => set(empty)
}));
