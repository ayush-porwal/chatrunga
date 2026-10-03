import type {
  ChapterKind,
  ImportPreview,
  ImportSelection,
  RepertoireChapterSummary
} from "@chaturanga/shared/types/repertoire";

/*
 * Search, selection and bounded rendering for the long repertoire lists: a collection imported as
 * hundreds of chapters, or the preview of a PGN holding hundreds of games.
 */

/** Lower-case words of a search box; none when it's blank. */
export function searchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** True when every term appears in one of `texts` (case-insensitive); no terms match everything. */
export function matchesTerms(terms: readonly string[], ...texts: string[]): boolean {
  if (!terms.length) return true;
  const haystack = texts.join("\n").toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/* ------------------------------------------------------------------ selection */

/** How much of `ids` is selected, as a "select all shown" checkbox shows it. */
export type SelectionState = "none" | "some" | "all";

export function selectionState(
  selected: ReadonlySet<string>,
  ids: readonly string[]
): SelectionState {
  let count = 0;
  for (const id of ids) if (selected.has(id)) count += 1;
  return count === 0 ? "none" : count === ids.length ? "all" : "some";
}

/** `selected` with `ids` added (`on`) or removed; ids outside `ids` keep their state. */
export function withSelection(
  selected: ReadonlySet<string>,
  ids: readonly string[],
  on: boolean
): Set<string> {
  const next = new Set(selected);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}

/** The selection without ids that no longer exist (a removed chapter drops out of it). */
export function existingSelection(
  selected: ReadonlySet<string>,
  ids: readonly string[]
): ReadonlySet<string> {
  const existing = new Set(ids);
  const kept = [...selected].filter((id) => existing.has(id));
  return kept.length === selected.size ? selected : new Set(kept);
}

/* ------------------------------------------------------------------ chapters */

/** Chapters (in the given order) whose title matches the search. */
export function filterChapters<T extends Pick<RepertoireChapterSummary, "title">>(
  chapters: readonly T[],
  query: string
): readonly T[] {
  const terms = searchTerms(query);
  return terms.length ? chapters.filter((chapter) => matchesTerms(terms, chapter.title)) : chapters;
}

export type ChapterBulkPatch = { enabled?: boolean; kind?: ChapterKind };

/** The selected chapters (in list order) that `patch` would change; the rest need no write. */
export function chaptersToChange(
  chapters: readonly Pick<RepertoireChapterSummary, "id" | "enabled" | "kind">[],
  selected: ReadonlySet<string>,
  patch: ChapterBulkPatch
): string[] {
  return chapters
    .filter(
      (chapter) =>
        selected.has(chapter.id) &&
        ((patch.enabled !== undefined && patch.enabled !== chapter.enabled) ||
          (patch.kind !== undefined && patch.kind !== chapter.kind))
    )
    .map((chapter) => chapter.id);
}

/* ------------------------------------------------------------------ windowing */

/**
 * The rows of a fixed-row-height list to mount: those within `viewport` (the scroll container's
 * visible span, measured from the list's top) plus `overscan` rows either side, and the `pinned`
 * rows wherever they are (the open chapter; the row holding keyboard focus, so scrolling or
 * filtering never unmounts the focused control). Sorted, so the DOM (and Tab) order stays the
 * list's order.
 */
export function windowedRows({
  count,
  rowHeight,
  viewport,
  overscan = 6,
  pinned = []
}: {
  count: number;
  rowHeight: number;
  viewport: { top: number; height: number };
  overscan?: number;
  pinned?: readonly number[];
}): number[] {
  if (count <= 0) return [];
  const first = Math.max(0, Math.floor(viewport.top / rowHeight) - overscan);
  const last = Math.min(
    count - 1,
    Math.ceil((viewport.top + Math.max(viewport.height, 0)) / rowHeight) + overscan
  );
  const rows = new Set<number>();
  for (let index = first; index <= last; index++) rows.add(index);
  for (const index of pinned) if (index >= 0 && index < count) rows.add(index);
  return [...rows].sort((a, b) => a - b);
}

/* ------------------------------------------------------------------ import preview */

/** Preview rows rendered at first, and added per "Show more". */
export const PREVIEW_PAGE_SIZE = 50;

/**
 * Indexes of the previewed games matching the search: by the chapter title as edited or the title
 * the PGN proposed, and a search that is only a number also finds that game ("12": game 12).
 */
export function filterGames(
  games: ImportPreview["games"],
  selections: readonly ImportSelection[],
  query: string
): number[] {
  const terms = searchTerms(query);
  const number = /^\d+$/.test(query.trim()) ? Number(query.trim()) : null;
  const indexes: number[] = [];
  games.forEach((game, index) => {
    const title = selections[index]?.title ?? "";
    if (game.index + 1 === number || matchesTerms(terms, title, game.proposedTitle)) {
      indexes.push(index);
    }
  });
  return indexes;
}

/**
 * Includes or excludes the games at `indexes`; a game without moves stays excluded (it has
 * nothing to import). Others keep their selection.
 */
export function setGamesIncluded(
  selections: readonly ImportSelection[],
  games: ImportPreview["games"],
  indexes: readonly number[],
  include: boolean
): ImportSelection[] {
  const targets = new Set(indexes);
  return selections.map((selection, index) =>
    targets.has(index) && selection.include !== (include && games[index]?.nodeCount > 0)
      ? { ...selection, include: include && games[index]?.nodeCount > 0 }
      : selection
  );
}

/** Sets the chapter kind of the included games among `indexes`. */
export function setGamesKind(
  selections: readonly ImportSelection[],
  indexes: readonly number[],
  kind: ChapterKind
): ImportSelection[] {
  const targets = new Set(indexes);
  return selections.map((selection, index) =>
    targets.has(index) && selection.include && selection.kind !== kind
      ? { ...selection, kind }
      : selection
  );
}
