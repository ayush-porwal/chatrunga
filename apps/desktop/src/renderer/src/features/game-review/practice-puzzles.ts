/**
 * The review summary's ways into Puzzles: the game's opening (Lichess puzzle OpeningTags) and the
 * themes behind the reviewed side's errors. Each sets the Puzzles page's filters; App then shows
 * the page, where the set starts.
 */
import type { PuzzleSampleInput } from "@chaturanga/shared/types/database";
import { DEFAULT_PUZZLE_FILTERS, usePuzzleDraftStore } from "../../stores/puzzle-draft-store";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { lichessOpeningTags, type PracticeTheme } from "./review-summary";

/** Whether the puzzle database has a puzzle tagged `tag` (null: it couldn't be checked). */
export type OpeningTagProbe = (tag: string) => Promise<boolean | null>;

/**
 * The OpeningTags filter for an opening: its exact variation, or its family when the database
 * has no puzzle of that variation (or the name has no variation). Null for a nameless opening.
 */
export async function openingPuzzleTag(
  name: string,
  hasPuzzles: OpeningTagProbe
): Promise<string | null> {
  const { family, variation } = lichessOpeningTags(name);
  if (!family) return null;
  if (!variation) return family;
  return (await hasPuzzles(variation)) === false ? family : variation;
}

/** What samplePuzzle says when no puzzle matches the filters. */
const NO_MATCH = /No puzzle matched/i;

/**
 * Asks the Lichess puzzle database (`databaseId`) for any puzzle tagged `tag`, over every rating.
 * False only when it has none; null when there is no database or the search failed.
 */
export function lichessOpeningProbe(databaseId: string | null): OpeningTagProbe {
  return async (tag) => {
    const api = window.chaturanga?.databases;
    if (!api || !databaseId) return null;
    const input: PuzzleSampleInput = {
      databaseId,
      lichess: {
        ratingMin: 0,
        ratingMax: 4000,
        popularityMin: -100,
        lengths: [],
        themes: [],
        openings: [tag],
        side: "any"
      }
    };
    try {
      await api.samplePuzzle(input);
      return true;
    } catch (error) {
      return NO_MATCH.test(ipcErrorMessage(error) || String(error)) ? false : null;
    }
  };
}

/**
 * The Puzzles page's set: puzzles of this opening from the Lichess puzzle database when one is
 * installed (`databaseId`); the other filters stay as they were.
 */
export function setOpeningPuzzleFilter(tag: string, databaseId: string | null): void {
  usePuzzleDraftStore.getState().update({
    ...(databaseId ? { databaseId } : {}),
    openings: [tag],
    themes: DEFAULT_PUZZLE_FILTERS.themes,
    lengths: DEFAULT_PUZZLE_FILTERS.lengths
  });
}

/** The Puzzles page's set: puzzles with this theme (see {@link setOpeningPuzzleFilter}). */
export function setThemePuzzleFilter(theme: PracticeTheme, databaseId: string | null): void {
  usePuzzleDraftStore.getState().update({
    ...(databaseId ? { databaseId } : {}),
    themes: [theme],
    openings: DEFAULT_PUZZLE_FILTERS.openings,
    lengths: DEFAULT_PUZZLE_FILTERS.lengths
  });
}
