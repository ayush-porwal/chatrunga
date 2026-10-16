import { create } from "zustand";
import type { Color, GameMode, GameSession, GameSource } from "@chaturanga/shared/types/chess";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import type { RepertoireColor } from "@chaturanga/shared/types/repertoire";
import type { BroadcastGameRef } from "../features/broadcasts/broadcast-follow";
import type { BroadcastScreen } from "../features/broadcasts/navigation";
import type { ReviewTab } from "../features/game-review/review-utils";
import type { PuzzleSessionConfig } from "../features/puzzles/PuzzlePage";
import type { StudyTab } from "../features/repertoire/RepertoireStudyPage";
import type { SettingsSectionId } from "../features/settings/SettingsPage";
import type { PlayOpponent } from "./lichess-store";

/**
 * Browser-like Back / Forward between the app's screens. An entry is a screen and the state it
 * was left in; the current entry is refreshed as you leave it (App's `commitCurrent`), so Back
 * returns to a screen as you left it, not as you arrived. Stepping through moves, switching tabs
 * and dialogs are not entries, and neither is anything else that stays on the same page (the
 * same game, chapter, tournament or settings): Back and Forward always change the page.
 */

/**
 * A puzzle set as a board's entry keeps it: which set (its id), its filters (the Puzzles page's
 * config) and the puzzles shown by then.
 */
type PuzzleSetRecord = { id: string; config: PuzzleSessionConfig; shownIds: string[] };

/** A board as it was: the game (saved id, or the whole session when it was never saved) and how it was shown. */
export type BoardSnapshot = {
  gameId: string | null;
  /** The game store's board counter: which board this was, saved or not (see samePage). */
  board: number;
  /** Only for a game without an id (nothing to reload it from). */
  session: GameSession | null;
  /** That unsaved game is a copy nobody changed yet (Play from here): restoring doesn't save it. */
  held?: true;
  currentNodeId: string;
  mode: GameMode;
  source: GameSource;
  /** The Analyze page's board (absent in entries from before it was kept). */
  analysisBoard?: boolean;
  engineSide: Color | null;
  orientation: Color;
  gameOutcome: { result: string; termination: string } | null;
  /** The workspace's side tab (an older build's "engine" reads as Moves: sideTabFrom). */
  tab: "notation" | "library";
  /** A puzzle on the board: restored by starting it again (never mid-solution). */
  puzzle: { sample: PuzzleSample } | null;
  /**
   * The puzzle set the board belongs to: its puzzle's, or a game played on from one (Play engine
   * from here), which comes back with its set and so with its Next puzzle.
   */
  puzzleSet: PuzzleSetRecord | null;
  /** The Lichess game on the board, if any: it can only be the one being played now. */
  lichessGameId: string | null;
  /** A broadcast game followed live on the board: restoring follows it again. */
  broadcast?: BroadcastGameRef;
};

export type HistoryEntry =
  | { view: "puzzles" }
  | { view: "databases" }
  | { view: "broadcasts" }
  | { view: "broadcast-tournament"; screen: BroadcastScreen }
  | { view: "settings"; section: SettingsSectionId | null }
  | { view: "play"; opponent: PlayOpponent | null }
  | { view: "game"; board: BoardSnapshot }
  | {
      view: "game-review";
      board: BoardSnapshot;
      tab: ReviewTab;
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
      tab: StudyTab;
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
  /**
   * A new screen: drops everything ahead (like a browser) and appends. Another state of the page
   * already shown (samePage) replaces the current entry instead.
   */
  push: (entry: HistoryEntry) => void;
  /** Swaps the current entry (a change that isn't a step of its own, e.g. the next puzzle). */
  replaceCurrent: (entry: HistoryEntry) => void;
  moveTo: (index: number) => void;
  /** Drops an entry that can't be shown any more (a deleted game), keeping the current one current. */
  removeAt: (index: number) => void;
};

export const useHistoryStore = create<HistoryStore>((set) => ({
  // The app opens on Play (its mode is the one it resolves to; restoring a null one keeps the current).
  entries: [{ view: "play", opponent: null }],
  index: 0,
  commitCurrent: (entry) =>
    set((state) => {
      const entries = state.entries.slice();
      entries[state.index] = entry;
      return { entries };
    }),
  push: (entry) =>
    set((state) => {
      const current = state.entries[state.index];
      if (samePage(current, entry)) return replaced(state, entry);
      const entries = [...state.entries.slice(0, state.index + 1), entry].slice(-HISTORY_LIMIT);
      return { entries, index: entries.length - 1 };
    }),
  replaceCurrent: (entry) => set((state) => replaced(state, entry)),
  moveTo: (index) => set((state) => (index >= 0 && index < state.entries.length ? { index } : {})),
  removeAt: (index) =>
    set((state) => {
      if (index < 0 || index >= state.entries.length || index === state.index) return {};
      const current = state.entries[state.index];
      const entries = state.entries.filter((_, position) => position !== index);
      return collapsed(entries, current);
    })
}));

/** The entries with the current one swapped for `entry`, merged with a neighbour of the same page. */
function replaced(
  state: Pick<HistoryStore, "entries" | "index">,
  entry: HistoryEntry
): Pick<HistoryStore, "entries" | "index"> {
  const entries = state.entries.slice();
  entries[state.index] = entry;
  return collapsed(entries, entry);
}

/**
 * Neighbouring entries of the same page made one (a replaced or removed entry can leave two side by
 * side), so no Back or Forward step stays on the page: `current` is kept of its pair, else the later.
 */
function collapsed(
  entries: HistoryEntry[],
  current: HistoryEntry
): Pick<HistoryStore, "entries" | "index"> {
  const kept: HistoryEntry[] = [];
  for (const entry of entries) {
    const last = kept.at(-1);
    if (last && samePage(last, entry)) {
      if (last !== current) kept[kept.length - 1] = entry;
    } else kept.push(entry);
  }
  return { entries: kept, index: Math.max(0, kept.indexOf(current)) };
}

/**
 * Whether two entries show the same page, whatever state each is in: the same view of the same
 * game (by id, or the same board before it was saved), chapter, practice session or tournament.
 * Moving between them isn't navigation, so it is never a step of Back / Forward.
 */
function samePage(left: HistoryEntry, right: HistoryEntry): boolean {
  if (left.view === "game" || left.view === "game-review")
    return right.view === left.view && sameBoard(left.board, right.board);
  if (left.view === "broadcast-tournament")
    return right.view === left.view && right.screen.tourId === left.screen.tourId;
  if (left.view === "repertoire-study")
    return (
      right.view === left.view &&
      right.repertoireId === left.repertoireId &&
      right.chapterId === left.chapterId
    );
  if (left.view === "repertoire-practice")
    return (
      right.view === left.view &&
      right.repertoireId === left.repertoireId &&
      right.sessionId === left.sessionId
    );
  return right.view === left.view;
}

/** The same game: its saved id, or the same board (one saved since keeps its board). */
function sameBoard(left: BoardSnapshot, right: BoardSnapshot): boolean {
  return (left.gameId !== null && left.gameId === right.gameId) || left.board === right.board;
}

export const selectCanGoBack = (state: HistoryStore) => state.index > 0;
export const selectCanGoForward = (state: HistoryStore) => state.index < state.entries.length - 1;
