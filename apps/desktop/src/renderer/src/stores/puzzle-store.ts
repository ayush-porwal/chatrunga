import { create } from "zustand";
import type { PuzzleSample } from "@chaturanga/shared/types/database";

type PuzzleFeedbackKind = "idle" | "correct" | "wrong" | "complete";

type PuzzleStore = {
  activePuzzle: PuzzleSample | null;
  solutionIndex: number;
  feedbackKind: PuzzleFeedbackKind;
  feedback: string | null;
  lastExpectedMove: string | null;
  setActivePuzzle: (puzzle: PuzzleSample | null) => void;
  advanceSolution: (count: number, feedback?: string) => void;
  markWrongMove: (input: { played: string; expected: string }) => void;
  markComplete: () => void;
  reset: () => void;
};

export const usePuzzleStore = create<PuzzleStore>((set) => ({
  activePuzzle: null,
  solutionIndex: 0,
  feedbackKind: "idle",
  feedback: null,
  lastExpectedMove: null,
  setActivePuzzle: (activePuzzle) =>
    set({
      activePuzzle,
      solutionIndex: 0,
      feedbackKind: "idle",
      feedback: activePuzzle ? "Find the best move." : null,
      lastExpectedMove: null
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
  markWrongMove: ({ played, expected }) =>
    set({
      feedbackKind: "wrong",
      feedback: `Not quite. ${played} is not the tactic.`,
      lastExpectedMove: expected
    }),
  markComplete: () =>
    set((state) => ({
      solutionIndex: state.activePuzzle?.solutionMoves.length ?? state.solutionIndex,
      feedbackKind: "complete",
      feedback: "Puzzle solved.",
      lastExpectedMove: null
    })),
  reset: () =>
    set({
      activePuzzle: null,
      solutionIndex: 0,
      feedbackKind: "idle",
      feedback: null,
      lastExpectedMove: null
    })
}));
