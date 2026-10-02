import { positionFromFen } from "@chaturanga/shared/chess/position";
import { rootPly } from "@chaturanga/shared/chess/pgn";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type ChapterKind,
  type RepertoireChapterSummary,
  type RepertoireColor,
  type RepertoireSummary
} from "@chaturanga/shared/types/repertoire";

/** Small pure helpers for chapter lists, labels and creation input. */

/** The root node of a new chapter starting at `fen`. */
export function rootNodeFor(fen: string): MoveNode {
  return {
    id: REPERTOIRE_ROOT_NODE_ID,
    parentId: null,
    san: null,
    uci: null,
    fenBefore: fen,
    fenAfter: fen,
    ply: rootPly(fen),
    nags: [],
    comment: null,
    arrows: [],
    highlights: [],
    children: []
  };
}

/** Chapters in their study order. */
export function sortedChapters<T extends Pick<RepertoireChapterSummary, "sortOrder">>(
  chapters: readonly T[]
): T[] {
  return [...chapters].sort((left, right) => left.sortOrder - right.sortOrder);
}

/**
 * The sort orders that swap a chapter with its neighbour (`direction` -1 up, +1 down), as
 * `[chapterId, sortOrder]` pairs for the chapters whose order changes. Distinct orders swap their
 * values; when any orders are shared (imported chapters), the whole list is renumbered so only the
 * two chapters trade places. Empty when there is no neighbour that way.
 */
export function chapterOrderAfterMove(
  chapters: readonly Pick<RepertoireChapterSummary, "id" | "sortOrder">[],
  chapterId: string,
  direction: -1 | 1
): Array<[string, number]> {
  const ordered = sortedChapters(chapters);
  const index = ordered.findIndex((chapter) => chapter.id === chapterId);
  const chapter = ordered[index];
  const neighbour = ordered[index + direction];
  if (!chapter || !neighbour) return [];
  const orders = new Set(ordered.map((item) => item.sortOrder));
  if (orders.size === ordered.length) {
    return [
      [chapter.id, neighbour.sortOrder],
      [neighbour.id, chapter.sortOrder]
    ];
  }
  const swapped = [...ordered];
  swapped[index] = neighbour;
  swapped[index + direction] = chapter;
  return swapped.flatMap(
    (item, position): Array<[string, number]> =>
      item.sortOrder === position ? [] : [[item.id, position]]
  );
}

/** The order a chapter appended after `chapters` gets. */
export function nextSortOrder(
  chapters: readonly Pick<RepertoireChapterSummary, "sortOrder">[]
): number {
  return chapters.reduce((max, chapter) => Math.max(max, chapter.sortOrder), -1) + 1;
}

export const KIND_LABELS: Record<ChapterKind, string> = {
  opening: "Opening",
  reference: "Reference"
};

export const COLOR_LABELS: Record<RepertoireColor, string> = {
  white: "White",
  black: "Black"
};

/** Why a custom starting FEN can't be used, or null when it is a legal position. */
export function fenError(fen: string): string | null {
  const trimmed = fen.trim();
  if (!trimmed) return "Enter a FEN.";
  try {
    positionFromFen(trimmed);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Not a legal position (${message.toLowerCase()}).`;
  }
}

/** "today" / "yesterday" / "3 days ago" / a date, for "last studied". */
export function relativeDay(timestamp: number | null, now: number): string {
  if (timestamp === null) return "Never";
  const day = 24 * 60 * 60 * 1000;
  const days = Math.floor((startOfDay(now) - startOfDay(timestamp)) / day);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** "1 chapter" / "3 decisions". */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Where a study screen opens: a chapter and optionally a node in it. */
export type StudyTarget = { repertoireId: string; chapterId: string; nodeId: string | null };

/** The repertoire with the most due decisions (where "Review due" starts), or null. */
export function mostDue<T extends Pick<RepertoireSummary, "dueCount">>(
  list: readonly T[]
): T | null {
  return list.reduce<T | null>(
    (best, item) => (item.dueCount > (best?.dueCount ?? 0) ? item : best),
    null
  );
}
