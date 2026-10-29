/**
 * Chapter openings (docs/repertoire-games-and-practice.md §2): the deepest position along a
 * chapter's mainline that the bundled opening book names. Detected when a chapter is saved
 * (created, imported, edited) and once in the background for chapters stored before (a chapter
 * the book doesn't name isn't looked at again until it changes); an opening the user typed is
 * never overwritten.
 */
import type { RepertoireChapter } from "@chaturanga/shared/types/repertoire";
import type {
  BookOpening,
  ChapterOpening,
  OpeningOfInput
} from "@chaturanga/shared/types/repertoire-practice";
import {
  deepestOpening,
  lineFens,
  mainlineFens
} from "@chaturanga/shared/chess/repertoire-mastery";
import { openingBook } from "../engine/opening-book";
import { queriesOn } from "../db/rows";
import { repertoireDb } from "./connection";
import { chapterRepository, RepertoireCorruptChapterError, transaction } from "./repository";
import { changed, withRepertoireWriteGate } from "./service-runtime";

/** The book's opening at the deepest named position of a line's moves from `rootFen`. */
export function openingOfLine(input: OpeningOfInput): BookOpening | null {
  return deepestOpening(openingBook(), lineFens(input.rootFen, input.moves));
}

/** The opening the book names along a chapter's mainline (null: none). */
export function detectChapterOpening(
  chapter: Pick<RepertoireChapter, "tree" | "rootFen">
): BookOpening | null {
  return deepestOpening(openingBook(), mainlineFens(chapter.tree, chapter.rootFen));
}

/**
 * The chapter with its opening as a save stores it: a typed one (`edited`) as it is, else the one
 * detected along its mainline now.
 */
export function withDetectedOpening<
  T extends Pick<RepertoireChapter, "tree" | "rootFen" | "opening">
>(chapter: T): T & { opening: ChapterOpening | null } {
  if (chapter.opening?.edited) return { ...chapter, opening: chapter.opening };
  const found = detectChapterOpening(chapter);
  return { ...chapter, opening: found ? { ...found, edited: false } : null };
}

let bookNames: BookOpening[] | null = null;

/** Every named opening of the book, by name (the Opening fields' suggestions). */
export function bookOpenings(): BookOpening[] {
  if (!bookNames) {
    const byName = new Map<string, string>();
    for (const opening of openingBook().values()) {
      if (opening && !byName.has(opening.name)) byName.set(opening.name, opening.eco);
    }
    bookNames = [...byName]
      .map(([name, eco]) => ({ name, eco }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return bookNames;
}

const { all, run } = queriesOn(repertoireDb);

/**
 * Ids of the chapters whose opening was never found nor typed, and that the background detection
 * hasn't looked at in their current revision.
 */
export function chaptersWithoutOpening(): string[] {
  return all<{ id: string }>(
    `SELECT id FROM repertoire_chapters WHERE opening_name IS NULL AND opening_edited = 0
      AND (opening_checked_revision IS NULL OR opening_checked_revision != revision)
      ORDER BY created_at, id`
  ).map((row) => row.id);
}

/** The detection looked at a chapter's current revision and found nothing to name it by. */
function markOpeningChecked(id: string): void {
  run("UPDATE repertoire_chapters SET opening_checked_revision = revision WHERE id = ?", id);
}

/** Sets a detected opening on a chapter (its revision stays): never over a typed one. */
function setDetectedOpening(id: string, opening: BookOpening): void {
  run(
    `UPDATE repertoire_chapters SET opening_name = ?, opening_eco = ?, opening_edited = 0
      WHERE id = ? AND opening_edited = 0`,
    opening.name,
    opening.eco,
    id
  );
}

/** Chapters the background detection reads between two yields to the event loop. */
const DETECTION_BATCH = 20;

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Detects the opening of every stored chapter that has none and wasn't typed, a few at a time
 * between yields (each batch one write through the write gate), so it never holds up the UI or
 * other writes for long. A chapter changed or removed meanwhile is skipped (its own save detects
 * it). Returns how many chapters got an opening.
 */
export async function detectMissingOpenings(): Promise<number> {
  const ids = chaptersWithoutOpening();
  let found = 0;
  for (let start = 0; start < ids.length; start += DETECTION_BATCH) {
    await yieldToEventLoop();
    found += await withRepertoireWriteGate(() =>
      transaction(() => {
        let batchFound = 0;
        for (const id of ids.slice(start, start + DETECTION_BATCH)) {
          let chapter: RepertoireChapter | null;
          try {
            chapter = chapterRepository.get(id);
          } catch (error) {
            if (!(error instanceof RepertoireCorruptChapterError)) throw error;
            markOpeningChecked(id);
            continue;
          }
          if (!chapter || chapter.opening) continue;
          const opening = detectChapterOpening(chapter);
          if (!opening) {
            markOpeningChecked(id);
            continue;
          }
          setDetectedOpening(id, opening);
          batchFound += 1;
        }
        return batchFound;
      })
    );
  }
  // The hub and Study list chapters with their opening: they read them again.
  if (found) changed({ repertoireId: null, revision: 0, kind: "updated" });
  return found;
}
