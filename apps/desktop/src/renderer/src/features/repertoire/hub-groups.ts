import type {
  RepertoireChapterSummary,
  RepertoireColor
} from "@chaturanga/shared/types/repertoire";
import { openingFamily } from "@chaturanga/shared/types/repertoire-practice";
import { sortedChapters } from "./repertoire-chapters";

/**
 * The hub's grouping (docs/repertoire-games-and-practice.md §2): repertoires by colour, White
 * first; a repertoire's chapters by opening family (the part of the opening's name before the
 * colon), families in the order their first chapter comes.
 */

const COLOR_ORDER: readonly RepertoireColor[] = ["white", "black"];

export function colorGroups<T extends { color: RepertoireColor }>(
  items: readonly T[]
): { color: RepertoireColor; items: T[] }[] {
  return COLOR_ORDER.map((color) => ({
    color,
    items: items.filter((item) => item.color === color)
  }));
}

/** A chapter's family heading when it has no opening. */
export const NO_OPENING_FAMILY = "Opening not detected";

export type ChapterFamily<T> = { family: string; chapters: T[] };

export function chapterFamilies<T extends Pick<RepertoireChapterSummary, "sortOrder" | "opening">>(
  chapters: readonly T[]
): ChapterFamily<T>[] {
  const families = new Map<string, T[]>();
  for (const chapter of sortedChapters(chapters)) {
    const name = chapter.opening?.name;
    const family = name ? openingFamily(name) : NO_OPENING_FAMILY;
    families.set(family, [...(families.get(family) ?? []), chapter]);
  }
  return [...families].map(([family, list]) => ({ family, chapters: list }));
}

/** The variation part of an opening's name ("Advance Variation"), or "" for a family name alone. */
export function openingVariation(name: string): string {
  const colon = name.indexOf(":");
  return colon < 0 ? "" : name.slice(colon + 1).trim();
}

/** "4 of 118 learned". */
export function learnedText(learned: number, total: number): string {
  return `${learned} of ${total} learned`;
}
