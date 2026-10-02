import { create } from "zustand";
import type { Color, GameMode, GameSession, GameSource } from "@chaturanga/shared/types/chess";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import type { RepertoireColor } from "@chaturanga/shared/types/repertoire";
import type { PlayOpponent } from "./lichess-store";

/**
 * Browser-like Back / Forward between the app's screens. An entry is a screen and the state it
 * was left in; the current entry is refreshed as you leave it (App's `commitCurrent`), so Back
 * returns to a screen as you left it, not as you arrived. Stepping through moves, switching tabs
 * and dialogs are not entries.
 */

/** A board as it was: the game (saved id, or the whole session when it was never saved) and how it was shown. */
export type BoardSnapshot = {
  gameId: string | null;
  /** Only for a game without an id (nothing to reload it from). */
  session: GameSession | null;
  currentNodeId: string;
  mode: GameMode;
  source: GameSource;
  engineSide: Color | null;
  orientation: Color;
  gameOutcome: { result: string; termination: string } | null;
  /** The workspace's side tab. */
  tab: "notation" | "engine" | "library";
  /** A puzzle on the board: restored by starting it again (never mid-solution). */
  puzzle: { sample: PuzzleSample; config: unknown } | null;
  /** The Lichess game on the board, if any: it can only be the one being played now. */
  lichessGameId: string | null;
};

export type HistoryEntry =
  | { view: "home" }
  | { view: "puzzles" }
  | { view: "databases" }
  | { view: "settings"; section: string | null }
  | { view: "play"; opponent: PlayOpponent | null }
  | { view: "game"; board: BoardSnapshot }
  | {
      view: "game-review";
      board: BoardSnapshot;
      tab: string;
      /** The Opening tab's picked side for this game (null: not picked, the default applies). */
      compareColor?: RepertoireColor | null;
    }
  | { view: "repertoire-hub" }
  | {
      view: "repertoire-study";
      repertoireId: string;
      chapterId: string;
      /** The selected node; moving through the tree updates the entry, it never adds one. */
      nodeId: string | null;
      /** The study panel tab. */
      tab: string;
      /** Board orientation (null: the repertoire's own colour). */
      orientation: Color | null;
    }
  | {
      view: "repertoire-practice";
      repertoireId: string;
      /** The session (null: the setup). Only committed attempts come back on restore. */
      sessionId: string | null;
    };

/** Oldest entries fall off beyond this. */
export const HISTORY_LIMIT = 50;

type HistoryStore = {
  entries: HistoryEntry[];
  index: number;
  /** Refreshes the current entry with the state being left. */
  commitCurrent: (entry: HistoryEntry) => void;
  /** A new screen: drops everything ahead (like a browser) and appends, unless it's the same as the current one. */
  push: (entry: HistoryEntry) => void;
  /** Swaps the current entry (a change that isn't a step of its own, e.g. the next puzzle). */
  replaceCurrent: (entry: HistoryEntry) => void;
  moveTo: (index: number) => void;
  /** Drops an entry that can't be shown any more (a deleted game), keeping the current one current. */
  removeAt: (index: number) => void;
};

export const useHistoryStore = create<HistoryStore>((set) => ({
  entries: [{ view: "home" }],
  index: 0,
  commitCurrent: (entry) =>
    set((state) => {
      const entries = state.entries.slice();
      entries[state.index] = entry;
      return { entries };
    }),
  push: (entry) =>
    set((state) => {
      if (sameEntry(state.entries[state.index], entry)) return {};
      const entries = [...state.entries.slice(0, state.index + 1), entry].slice(-HISTORY_LIMIT);
      return { entries, index: entries.length - 1 };
    }),
  replaceCurrent: (entry) =>
    set((state) => {
      const entries = state.entries.slice();
      entries[state.index] = entry;
      return { entries };
    }),
  moveTo: (index) => set((state) => (index >= 0 && index < state.entries.length ? { index } : {})),
  removeAt: (index) =>
    set((state) => {
      if (index < 0 || index >= state.entries.length || index === state.index) return {};
      const entries = state.entries.filter((_, position) => position !== index);
      return { entries, index: index < state.index ? state.index - 1 : state.index };
    })
}));

/** Same screen in the same state (a repeated click on where you already are adds nothing). */
export function sameEntry(left: HistoryEntry | undefined, right: HistoryEntry): boolean {
  return Boolean(left) && JSON.stringify(left) === JSON.stringify(right);
}

export const selectCanGoBack = (state: HistoryStore) => state.index > 0;
export const selectCanGoForward = (state: HistoryStore) => state.index < state.entries.length - 1;
