/**
 * The Repertoire overhaul's practice home (docs/repertoire-games-and-practice.md §2, §4): chapter
 * openings, the global practice settings, and the Practice tab's sets and progress.
 */
import type { RepertoireColor } from "./repertoire";

/** A named opening of the bundled book (lichess-org/chess-openings). */
export type BookOpening = { name: string; eco: string };

/**
 * A chapter's opening: detected from the book along its mainline, or typed by the user (`edited`;
 * never overwritten by detection then). A typed name outside the book has no ECO.
 */
export type ChapterOpening = { name: string; eco: string | null; edited: boolean };

/** Longest opening name a chapter keeps (the book's longest is under 100 characters). */
export const MAX_OPENING_NAME = 200;

/** The opening family a name belongs to: the part before the colon ("Caro-Kann Defense"). */
export function openingFamily(name: string): string {
  return name.split(":")[0].trim();
}

/* ------------------------------------------------------------------ practice settings */

/** "New positions per day" choices; null is no limit. */
export const NEW_PER_DAY_CHOICES = [5, 10, 20, 50, null] as const;
export type NewPerDay = (typeof NEW_PER_DAY_CHOICES)[number];

/** The global practice settings (Practice tab's cog). */
export type RepertoirePracticeSettings = {
  /** Positions answered for the first time per local day, across all repertoires. */
  newPerDay: NewPerDay;
  /** The first time a position comes up, its move is shown and the player plays it. */
  showMoveOnNew: boolean;
  /** A chime for a right answer and a low tone for a wrong one. */
  sounds: boolean;
};

export const DEFAULT_PRACTICE_SETTINGS: RepertoirePracticeSettings = {
  newPerDay: 10,
  showMoveOnNew: true,
  sounds: true
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Stored practice settings read back: each bad or missing field takes its default. */
export function normalizeRepertoirePracticeSettings(value: unknown): RepertoirePracticeSettings {
  const stored = isRecord(value) ? value : {};
  // `find` gives null for a stored "no limit", undefined for anything that isn't a choice.
  const perDay = NEW_PER_DAY_CHOICES.find((choice) => choice === stored.newPerDay);
  return {
    newPerDay: perDay === undefined ? DEFAULT_PRACTICE_SETTINGS.newPerDay : perDay,
    showMoveOnNew:
      typeof stored.showMoveOnNew === "boolean"
        ? stored.showMoveOnNew
        : DEFAULT_PRACTICE_SETTINGS.showMoveOnNew,
    sounds: typeof stored.sounds === "boolean" ? stored.sounds : DEFAULT_PRACTICE_SETTINGS.sounds
  };
}

/** Whether `value` is exactly a practice settings object (what the settings write accepts). */
export function isRepertoirePracticeSettings(value: unknown): value is RepertoirePracticeSettings {
  return (
    isRecord(value) &&
    Object.keys(value).length === 3 &&
    NEW_PER_DAY_CHOICES.some((choice) => choice === value.newPerDay) &&
    typeof value.showMoveOnNew === "boolean" &&
    typeof value.sounds === "boolean"
  );
}

/** Repertoire's title-bar tabs. */
export const REPERTOIRE_HUB_TABS = ["repertoires", "practice", "insights"] as const;
export type RepertoireHubTab = (typeof REPERTOIRE_HUB_TABS)[number];

/* ------------------------------------------------------------------ Practice tab */

/** Where a practised decision stands (derived, never stored). */
export type MasteryCounts = {
  /** Next review 21 or more days after the last attempt. */
  mastered: number;
  /** Attempted, not mastered. */
  learning: number;
  /** Never attempted. */
  new: number;
};

/** A chapter row of the hub's expander. */
export type ChapterPracticeStats = {
  chapterId: string;
  /** The player's trainable decisions this chapter supports (shared ones count in each chapter). */
  moves: number;
  due: number;
};

/** One repertoire's practice standing (the Practice tab's card, progress and the hub's rows). */
export type RepertoirePracticeStats = MasteryCounts & {
  repertoireId: string;
  name: string;
  color: RepertoireColor;
  chapterCount: number;
  /** Trainable decisions ("Your moves"). */
  decisions: number;
  due: number;
  /** Decisions at stage ≥ 1. */
  learned: number;
  /** Learning decisions not due now (what Practice early asks). */
  learningNotDue: number;
  /** When the next review falls due (null: nothing scheduled). */
  nextDueAt: number | null;
  perfectLines: number;
  lines: number;
  chapters: ChapterPracticeStats[];
  /** The first chapter's starting position (the card's thumbnail); null without chapters. */
  firstChapterFen: string | null;
};

/** The Practice tab: every active repertoire, and today's new positions. */
export type PracticeOverview = {
  repertoires: RepertoirePracticeStats[];
  /** Positions answered for the first time today (local day), across all repertoires. */
  newToday: number;
  /** The daily limit (null: no limit). */
  newPerDay: NewPerDay;
};

/** `window.chaturanga.repertoires.openingOf`'s question: a line's moves (UCI) from a position. */
export type OpeningOfInput = { rootFen: string; moves: string[] };
