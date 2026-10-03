import { create } from "zustand";
import type { PuzzleSessionConfig } from "../features/puzzles/PuzzlePage";

/** The Puzzles page's choices before a set starts. */
export type PuzzleDraft = {
  /** "" = the preferred installed database. */
  databaseId: string;
  themes: string[];
  lengths: string[];
  openings: string[];
  side: "any" | "white" | "black";
  ratingMin: number;
  ratingMax: number;
  popularityMin: number;
  difficultyMin: number;
  difficultyMax: number;
  positionTags: string[];
};

export const DEFAULT_PUZZLE_FILTERS: Omit<PuzzleDraft, "databaseId"> = {
  themes: [],
  lengths: [],
  openings: [],
  side: "any",
  ratingMin: 600,
  ratingMax: 2800,
  popularityMin: 0,
  difficultyMin: 1,
  difficultyMax: 4,
  positionTags: ["initiative", "development"]
};

/** The draft a set was started from: its database and every filter ("Edit set" reopens the Puzzles page with it). */
export function draftFromSessionConfig(config: PuzzleSessionConfig): PuzzleDraft {
  const { lichess, position } = config;
  return {
    databaseId: config.databaseId ?? "",
    themes: [...lichess.themes],
    lengths: [...lichess.lengths],
    openings: [...lichess.openings],
    side: lichess.side,
    ratingMin: lichess.ratingMin,
    ratingMax: lichess.ratingMax,
    popularityMin: lichess.popularityMin,
    difficultyMin: position.difficultyMin,
    difficultyMax: position.difficultyMax,
    positionTags: [...position.tags]
  };
}

type PuzzleDraftStore = {
  draft: PuzzleDraft;
  update: (patch: Partial<PuzzleDraft>) => void;
  /** Back to the default filters (the chosen database stays). */
  resetFilters: () => void;
};

/**
 * Kept outside the page, so a detour (Manage databases, Settings) and Back return to the same
 * filters instead of the defaults.
 */
export const usePuzzleDraftStore = create<PuzzleDraftStore>((set) => ({
  draft: { databaseId: "", ...DEFAULT_PUZZLE_FILTERS },
  update: (patch) => set((state) => ({ draft: { ...state.draft, ...patch } })),
  resetFilters: () => set((state) => ({ draft: { databaseId: state.draft.databaseId, ...DEFAULT_PUZZLE_FILTERS } }))
}));
