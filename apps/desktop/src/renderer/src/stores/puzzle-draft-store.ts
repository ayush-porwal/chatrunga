import { create } from "zustand";

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
