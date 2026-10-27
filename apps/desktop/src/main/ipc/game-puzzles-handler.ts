import { ipcMain } from "electron";
import { retryOnceIfBusy } from "../db/repositories";
import type { GamePuzzleQueue } from "../game-puzzles/generation-queue";
import { gamePuzzleRepository } from "../game-puzzles/repository";
import {
  parseGamePuzzleAttemptInput,
  parseGamePuzzleQuery,
  parseGamePuzzleSettings
} from "./validate-game-puzzles";

/**
 * Puzzles from the user's games: the queue (its changes go out on `gamePuzzles:progress`), the
 * "My games" card, and the "From my games" set. Attempts schedule the puzzle only; the puzzle
 * rating is never touched.
 */
export function registerGamePuzzleIpc(queue: GamePuzzleQueue): void {
  ipcMain.handle("gamePuzzles:summary", () => queue.summary());
  ipcMain.handle("gamePuzzles:countGames", (_event, settings: unknown) =>
    queue.countGames(parseGamePuzzleSettings(settings))
  );
  ipcMain.handle("gamePuzzles:start", (_event, settings: unknown) =>
    queue.enqueueMatching(parseGamePuzzleSettings(settings))
  );
  ipcMain.handle("gamePuzzles:pause", () => queue.pause());
  ipcMain.handle("gamePuzzles:resume", () => queue.resume());
  ipcMain.handle("gamePuzzles:cancel", () => queue.cancel());
  ipcMain.handle("gamePuzzles:status", () => queue.status());
  ipcMain.handle("gamePuzzles:list", (_event, query: unknown) =>
    gamePuzzleRepository.list(parseGamePuzzleQuery(query))
  );
  ipcMain.handle("gamePuzzles:next", (_event, query: unknown) =>
    gamePuzzleRepository.next(parseGamePuzzleQuery(query))
  );
  // An attempt the user would otherwise lose: one more try if the import writer holds the lock.
  ipcMain.handle("gamePuzzles:recordAttempt", (_event, input: unknown) => {
    const attempt = parseGamePuzzleAttemptInput(input);
    return retryOnceIfBusy(() => gamePuzzleRepository.recordAttempt(attempt));
  });
  ipcMain.handle("gamePuzzles:lastSettings", () => gamePuzzleRepository.lastSettings());
}
