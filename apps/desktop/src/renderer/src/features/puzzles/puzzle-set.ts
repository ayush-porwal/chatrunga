import { PUZZLE_DIFFICULTIES } from "@chaturanga/shared/chess/puzzle-rating";
import { externalDatabaseSources } from "@chaturanga/shared/types/database";
import type { PuzzleSessionConfig } from "./PuzzlePage";

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
