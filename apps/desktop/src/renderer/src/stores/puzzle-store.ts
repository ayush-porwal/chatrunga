import { nanoid } from "nanoid";
import { create } from "zustand";
import type { PuzzleSample } from "@chaturanga/shared/types/database";

/** `broken`: the puzzle's own data is broken (a scripted reply can't be played), so it ended there. */
export type PuzzleFeedbackKind = "idle" | "correct" | "wrong" | "complete" | "broken";

/**
 * How the puzzle went, as Lichess scores it: `failed` from the first wrong move or from opening
 * the solution before it is solved (it stays failed even when finished afterwards), `solved` when
 * the last move is found with neither. `pending` until one of those happens. `void`: the puzzle's
 * data broke before it was decided — neither solved nor failed, nothing to rate.
 */
export type PuzzleOutcome = "pending" | "solved" | "failed" | "void";

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
  /**
   * This try's own id: every puzzle shown — the same one started again too (Back) — is a new try,
   * so nothing of the last one (the solution left open) carries over to it.
   * Recording it is idempotent on it.
   */
  id: string;
  puzzleId: string;
  databaseId: string;
  sourceId: string;
  /** The puzzle's own rating and its deviation (Lichess sets; null for position sets). */
  puzzleRating: number | null;
  puzzleRatingDeviation: number | null;
  /** The puzzle's themes (per-theme statistics). */
  themes: string[];
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

/** An attempt whose outcome is known, as the attempt events carry it (a void one sends none). */
export type DecidedPuzzleAttempt = PuzzleAttempt & { outcome: Exclude<PuzzleOutcome, "pending" | "void"> };

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
  /**
   * The scripted reply couldn't be played (bad puzzle data): the puzzle ends there, broken — void
   * if it wasn't decided yet (the solver isn't failed, and nothing is reported to rate).
   */
  markReplyFailed: () => void;
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
  if (!state.attempt || state.outcome === "pending" || state.outcome === "void") return;
  const event: PuzzleAttemptEvent = { kind, attempt: { ...state.attempt, outcome: state.outcome } };
  for (const listener of [...listeners]) listener(event);
}

/** The solver's first wrong move (what an explanation starts from), or null. */
export function selectFirstWrongMove(state: Pick<PuzzleStore, "attempt">): PuzzleWrongMove | null {
  return state.attempt?.wrongMoves[0] ?? null;
}

function newAttempt(puzzle: PuzzleSample): PuzzleAttempt {
  return {
    id: nanoid(),
    puzzleId: puzzle.id,
    databaseId: puzzle.databaseId,
    sourceId: puzzle.sourceId,
    puzzleRating: puzzle.rating ?? null,
    puzzleRatingDeviation: puzzle.ratingDeviation ?? null,
    themes: [...puzzle.themes],
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
    const { attempt, outcome, solutionIndex, feedbackKind } = get();
    if (feedbackKind === "broken") return;
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
  markReplyFailed: () =>
    set((state) => ({
      feedbackKind: "broken",
      feedback: "This puzzle's data is broken — skip it.",
      lastExpectedMove: null,
      outcome: state.outcome === "pending" ? "void" : state.outcome
    })),
  revealSolution: () => {
    const { attempt, outcome } = get();
    if (!attempt || attempt.completedAt !== null || attempt.solutionViewed || outcome === "void") return;
    const deciding = outcome === "pending";
    set({
      outcome: "failed",
      attempt: { ...attempt, solutionViewed: true, decidedAt: attempt.decidedAt ?? Date.now() }
    });
    if (deciding) emit("decided", get());
  },
  markComplete: () => {
    const { attempt, outcome, feedbackKind } = get();
    if (feedbackKind === "broken") return;
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
