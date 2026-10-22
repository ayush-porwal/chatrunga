import { ratingRangeFor } from "@chaturanga/shared/chess/puzzle-rating";
import { externalDatabaseSources, type InstalledDatabase } from "@chaturanga/shared/types/database";
import type { PuzzleDraft } from "../../stores/puzzle-draft-store";
import type { PuzzleSessionConfig } from "./PuzzlePage";

type DatabaseRef = Pick<InstalledDatabase, "id" | "sourceId">;

/** The installed databases puzzles are drawn from (puzzle and position sets). */
export function puzzleDatabasesOf<T extends Pick<InstalledDatabase, "kind">>(
  databases: readonly T[]
): T[] {
  return databases.filter((item) => item.kind === "puzzle" || item.kind === "position");
}

/**
 * Which puzzle databases are installed, as they are now (each one's id, size and update time):
 * a key that changes when one is added, removed or replaced, so what was read from them is read
 * again (Play's Puzzle of the day). Order-independent.
 */
export function puzzleDatabasesKey(
  databases: readonly Pick<InstalledDatabase, "id" | "kind" | "fileSizeBytes" | "updatedAt">[]
): string {
  return puzzleDatabasesOf(databases)
    .map((item) => `${item.id}:${item.fileSizeBytes}:${item.updatedAt}`)
    .sort()
    .join("|");
}

/** The set Puzzles draws from: the draft's database, else Lichess puzzles, else the first one. */
export function selectedPuzzleDatabase<T extends DatabaseRef>(
  databases: readonly T[],
  draftDatabaseId: string
): T | null {
  return (
    databases.find((item) => item.id === draftDatabaseId) ??
    databases.find((item) => item.sourceId === "lichess-puzzles") ??
    databases.at(0) ??
    null
  );
}

/**
 * The Lichess rating range a set draws from: with "Around my rating" (Lichess sets only), the range
 * around the solver's `rating` now (`aroundRating`); else the draft's own.
 */
export function drawnRatingRange(
  draft: Pick<PuzzleDraft, "difficulty" | "ratingMin" | "ratingMax">,
  isLichess: boolean,
  rating: number
): { ratingMin: number; ratingMax: number; aroundRating: boolean } {
  const around = isLichess && draft.difficulty ? ratingRangeFor(rating, draft.difficulty) : null;
  return {
    ratingMin: around?.ratingMin ?? draft.ratingMin,
    ratingMax: around?.ratingMax ?? draft.ratingMax,
    aroundRating: around !== null
  };
}

/**
 * Whether the draft's filters for the set's kind differ from the defaults (Reset filters shows).
 */
export function puzzleFiltersChanged(draft: PuzzleDraft, isLichess: boolean): boolean {
  if (!isLichess)
    return (
      draft.difficultyMin !== 1 ||
      draft.difficultyMax !== 4 ||
      draft.positionTags.join() !== "initiative,development"
    );
  return (
    draft.themes.length > 0 ||
    draft.lengths.length > 0 ||
    draft.openings.length > 0 ||
    draft.side !== "any" ||
    draft.ratingMin !== 600 ||
    draft.ratingMax !== 2800 ||
    draft.difficulty !== null ||
    draft.popularityMin !== 0
  );
}

/** More filters' summary while folded: the ones set ("Italian Game · popularity 20+"), else null. */
export function moreFiltersSummary(
  openings: readonly string[],
  popularityMin: number
): string | null {
  const openingsPart =
    openings.length === 1
      ? [formatPuzzleTag(openings[0])]
      : openings.length
        ? [`${openings.length} openings`]
        : [];
  const parts = [...openingsPart, ...(popularityMin !== 0 ? [`popularity ${popularityMin}+`] : [])];
  return parts.length ? parts.join(" · ") : null;
}

/**
 * The set the Puzzles page's choices (`draft`) start on `database`. "Around my rating" draws the
 * Lichess range from the solver's `rating` now.
 */
export function puzzleSetConfig(
  draft: PuzzleDraft,
  database: DatabaseRef,
  rating: number
): PuzzleSessionConfig {
  const isLichess = database.sourceId === "lichess-puzzles";
  const range = drawnRatingRange(draft, isLichess, rating);
  return {
    databaseId: database.id,
    mode: isLichess ? "lichess-puzzle" : "position-training",
    difficulty: isLichess ? draft.difficulty : null,
    lichess: {
      ratingMin: range.ratingMin,
      ratingMax: range.ratingMax,
      popularityMin: draft.popularityMin,
      lengths: draft.lengths,
      themes: draft.themes,
      openings: draft.openings,
      side: draft.side
    },
    position: {
      difficultyMin: draft.difficultyMin,
      difficultyMax: draft.difficultyMax,
      tags: draft.positionTags
    }
  };
}

/** Display label for a Lichess/strategic tag value: "Caro-Kann_Defense" → "Caro-Kann Defense", "mateIn2" → "mate in 2". */
export function formatPuzzleTag(value: string): string {
  if (value.includes("_")) return value.replace(/_/g, " ");
  return value.replace(/([a-z])([A-Z0-9])/g, "$1 $2").toLowerCase();
}

/** The dataset's short name ("Lichess puzzles", "Chess positions"), else `fallback` (its installed name). */
export function puzzleDatasetLabel(sourceId: string, fallback: string): string {
  const source = externalDatabaseSources.find((item) => item.id === sourceId);
  return source?.shortName ?? source?.name ?? fallback;
}
