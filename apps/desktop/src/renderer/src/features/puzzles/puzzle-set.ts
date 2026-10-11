import { PUZZLE_DIFFICULTIES, ratingRangeFor } from "@chaturanga/shared/chess/puzzle-rating";
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
 * The set the Puzzles page's choices (`draft`) start on `database`. "Around my rating" draws the
 * Lichess range from the solver's `rating` now.
 */
export function puzzleSetConfig(
  draft: PuzzleDraft,
  database: DatabaseRef,
  rating: number
): PuzzleSessionConfig {
  const isLichess = database.sourceId === "lichess-puzzles";
  const around = isLichess && draft.difficulty ? ratingRangeFor(rating, draft.difficulty) : null;
  return {
    databaseId: database.id,
    mode: isLichess ? "lichess-puzzle" : "position-training",
    difficulty: isLichess ? draft.difficulty : null,
    lichess: {
      ratingMin: around?.ratingMin ?? draft.ratingMin,
      ratingMax: around?.ratingMax ?? draft.ratingMax,
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

/**
 * The puzzle set as one line: the dataset, then the filters chosen for it — only those that narrow
 * it ("Lichess puzzles · Rating 1200–1800 · fork, pin", "Chess positions · Difficulty 1–4 · initiative").
 * Failed puzzles tried again are just that ("Lichess puzzles · 12 failed puzzles again").
 */
export function puzzleSetSummary(config: PuzzleSessionConfig, dataset: string): string {
  const parts = [dataset];
  if (config.retryIds) {
    const count = config.retryIds.length;
    parts.push(`${count} failed ${count === 1 ? "puzzle" : "puzzles"} again`);
  } else if (config.mode === "lichess-puzzle") {
    const { ratingMin, ratingMax, popularityMin, side, themes, lengths, openings } = config.lichess;
    const difficulty = PUZZLE_DIFFICULTIES.find((item) => item.id === config.difficulty);
    parts.push(
      `Rating ${ratingMin}–${ratingMax}${difficulty ? ` (${difficulty.label.toLowerCase()}, around yours)` : ""}`
    );
    if (side !== "any") parts.push(`${side === "white" ? "White" : "Black"} to move`);
    if (popularityMin !== 0) parts.push(`Popularity ${popularityMin}+`);
    for (const tags of [themes, lengths, openings])
      if (tags.length) parts.push(tags.map(formatPuzzleTag).join(", "));
  } else {
    const { difficultyMin, difficultyMax, tags } = config.position;
    parts.push(`Difficulty ${difficultyMin}–${difficultyMax}`);
    if (tags.length) parts.push(tags.map(formatPuzzleTag).join(", "));
  }
  return parts.join(" · ");
}
