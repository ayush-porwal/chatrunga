/**
 * What every repertoire service module shares: the service clock, change broadcasts, reading
 * stored chapters, and the write gate every repertoire write passes.
 */
import {
  CHAPTER_NOT_FOUND_ERROR,
  type RepertoireChangedEvent,
  type RepertoireChapter
} from "@chaturanga/shared/types/repertoire";
import { broadcast } from "../ipc/broadcast";
import {
  chapterRepository,
  actionableBusyError,
  RepertoireCorruptChapterError
} from "./repository";

export const IMPORT_JOB_TTL_MS = 30 * 60_000;

/** Pending import previews kept in memory at once; each holds its parsed game trees. */
export const MAX_IMPORT_JOBS = 3;

/** Injectable clock (tests); main-process time is the only time grading uses. */
let now: () => number = () => Date.now();

/** The service's current time (see setRepertoireClock). */
export function clock(): number {
  return now();
}

/** Replaces the service clock (tests only); pass nothing to restore `Date.now`. */
export function setRepertoireClock(next?: () => number): void {
  now = next ?? (() => Date.now());
}

/* Main's own listeners to repertoire changes (the explorer's health check re-checks after edits). */
const changeListeners = new Set<(event: RepertoireChangedEvent) => void>();

/** Calls `listener` after every repertoire change; returns the unsubscribe. */
export function onRepertoireChanged(listener: (event: RepertoireChangedEvent) => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

export function changed(event: RepertoireChangedEvent): void {
  broadcast("repertoires:changed", event);
  for (const listener of changeListeners) listener(event);
}

/**
 * The stored version of a chapter about to be overwritten or removed; undefined when it is
 * damaged, so the caller rebuilds the derived state in full instead of updating it.
 */
export function storedChapter(chapterId: string): RepertoireChapter | undefined {
  try {
    return chapterRepository.get(chapterId) ?? undefined;
  } catch (error) {
    if (error instanceof RepertoireCorruptChapterError) return undefined;
    throw error;
  }
}

/** A stored chapter with its current due count. */
export function loadChapter(
  repertoireId: string,
  chapterId: string,
  now: number
): RepertoireChapter {
  if (chapterRepository.ownerOf(chapterId)?.repertoireId !== repertoireId) {
    throw new Error(CHAPTER_NOT_FOUND_ERROR);
  }
  const chapter = chapterRepository.get(chapterId)!;
  return { ...chapter, dueCount: chapterRepository.dueCount(chapterId, now) };
}

/* Repertoire write gate (design §11): one repertoire write at a time, across every repertoire. */
let writeGate: Promise<unknown> = Promise.resolve();

/**
 * Runs a repertoire write once every write already admitted has finished, and settles with its
 * value. Every repertoire write goes through here (the IPC handlers wrap each one; an import
 * commit holds the gate while the writer worker runs its whole transaction), so a main-thread
 * write waits for the writer asynchronously instead of sleeping in SQLite's busy handler with the
 * main process blocked. Reads never pass the gate. A failed write doesn't block the ones after
 * it; a write that still finds the database locked rejects with the actionable busy error.
 */
export function withRepertoireWriteGate<T>(work: () => T | Promise<T>): Promise<T> {
  const run = async () => {
    try {
      return await work();
    } catch (error) {
      throw actionableBusyError(error);
    }
  };
  const result = writeGate.then(run, run);
  writeGate = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
