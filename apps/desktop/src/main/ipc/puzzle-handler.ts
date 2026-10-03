import { ipcMain } from "electron";
import { puzzleAttemptRepository } from "../db/puzzle-attempts";
import { retryOnceIfBusy } from "../db/repositories";
import { asId, parseListLimit, parseRecordPuzzleAttemptInput } from "./validate";

let recording: Promise<unknown> = Promise.resolve();

/**
 * Runs recordings one at a time, in the order they arrived: an attempt waiting out a busy retry
 * is rated before a later one, so the rating chain follows the order the puzzles were decided.
 * A failed recording doesn't hold up the next.
 */
function inArrivalOrder<T>(work: () => Promise<T>): Promise<T> {
  const result = recording.then(work);
  recording = result.catch(() => undefined);
  return result;
}

/** The local puzzle rating: decided attempts (rated in main), the rating, its history and statistics. */
export function registerPuzzleIpc(): void {
  // An attempt the user would otherwise lose: one more try if the import writer holds the lock.
  ipcMain.handle("puzzles:recordAttempt", (_event, input: unknown) => {
    const attempt = parseRecordPuzzleAttemptInput(input);
    return inArrivalOrder(() => retryOnceIfBusy(() => puzzleAttemptRepository.record(attempt)));
  });
  ipcMain.handle("puzzles:ratingSummary", () => puzzleAttemptRepository.summary());
  ipcMain.handle("puzzles:ratingHistory", (_event, limit: unknown) =>
    puzzleAttemptRepository.history(parseListLimit(limit, 200, 2000))
  );
  ipcMain.handle("puzzles:themeStats", (_event, limit: unknown) =>
    puzzleAttemptRepository.themeStats(parseListLimit(limit, 50, 500))
  );
  ipcMain.handle("puzzles:failedPuzzles", (_event, sourceId: unknown, limit: unknown) =>
    puzzleAttemptRepository.failed(
      sourceId === null || sourceId === undefined ? null : asId(sourceId, "database source"),
      parseListLimit(limit, 100, 1000)
    )
  );
}
