/**
 * Study's explorer and the repertoire health check for the rest of main: the game position index
 * and the health queue (runtime.ts) load after startup, out of the main bundle; this starts them,
 * hands them to the IPC handlers and stops them on quit.
 */
import type { EngineManager } from "../engine/engine-manager";
import type { GamePuzzleQueue } from "../game-puzzles/generation-queue";
import { logger } from "../logger";
import type { RepertoireExplorer } from "./runtime";

let explorer: Promise<RepertoireExplorer> | null = null;

/**
 * App start: loads and starts the index and the health queue (once). `puzzles` is the puzzle queue
 * the health check waits for.
 */
export function startRepertoireExplorer(
  engineManager: EngineManager,
  puzzles: Pick<GamePuzzleQueue, "status">
): void {
  if (explorer) return;
  explorer = import("./runtime").then((runtime) =>
    runtime.startRepertoireExplorer(engineManager, puzzles)
  );
  explorer.catch((error: unknown) => logger.error("repertoire-explorer", "loading failed:", error));
}

/** The started explorer, for its IPC handlers. */
export function repertoireExplorer(): Promise<RepertoireExplorer> {
  return explorer ?? Promise.reject(new Error("The repertoire explorer hasn't started"));
}

/** Quitting: stops what started (nothing when it never loaded). */
export async function stopRepertoireExplorer(): Promise<void> {
  const started = await explorer?.catch(() => null);
  await started?.stop();
}
