/**
 * Main's one puzzle generation queue (generation-queue.ts), wired to the app: the default engine
 * on its own UCI process (Threads and Hash from the engine settings: it steps aside while the user
 * uses an engine), Maia 3 at review priority,
 * the bundled opening book, the connected accounts, and the review hook on the EngineManager.
 */
import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import type { GamePuzzleEngineState } from "@chaturanga/shared/types/game-puzzles";
import { getChesscomAccountStore } from "../chesscom";
import { engineRepository, settingsRepository } from "../db/repositories";
import { engineResourceOptions } from "../engine/engine-config";
import type { EngineManager } from "../engine/engine-manager";
import { openingBook } from "../engine/opening-book";
import { UciReviewSession } from "../engine/uci-review-session";
import { broadcast } from "../ipc/broadcast";
import { getLichessAccountStore } from "../lichess";
import { errorMessage, logger } from "../logger";
import { getMaia3Evaluator } from "../maia";
import { attachReviewHook, GamePuzzleQueue, type OpenedEngine } from "./generation-queue";

let queue: GamePuzzleQueue | null = null;
let noteReview: ((reviewId: string, gameId: string | null | undefined) => void) | null = null;

/** Lc0 (the managed one, or a user's: its network, or its name) isn't searched by the queue. */
function isLc0(config: EngineConfig): boolean {
  if (config.weightsPath?.trim()) return true;
  return /\blc0\b|leela/i.test(`${config.name} ${basename(config.executablePath)}`);
}

/** The default engine and whether a background queue can search with it (also the health check's). */
export function defaultEngine(): { state: GamePuzzleEngineState; config: EngineConfig | null } {
  const config = engineRepository.list().find((engine) => engine.isDefault);
  if (!config || config.runtime === "maia3" || !existsSync(config.executablePath))
    return { state: "missing", config: null };
  return isLc0(config) ? { state: "lc0", config: null } : { state: "ready", config };
}

/** One UCI process of `config` for a background queue (also the health check's). */
export async function openEngine(config: EngineConfig, signal: AbortSignal): Promise<OpenedEngine> {
  const cancelled = () => signal.aborted;
  const session = new UciReviewSession(config, cancelled);
  try {
    await session.start({ multipv: 1, ...engineResourceOptions() });
  } catch (error) {
    session.stop();
    throw error;
  }
  return {
    analyse: (fen, search) =>
      session.analyze({
        fen,
        multipv: search.multipv,
        search: {
          nodes: null,
          moveTimeMs: null,
          depth: search.depth,
          recordMoveTimeMs: null,
          recordDepth: search.depth
        },
        searchMoves: search.searchmoves,
        shouldCancel: cancelled
      }),
    close: () => session.stop()
  };
}

/**
 * The connected Lichess and Chess.com usernames, and whether an account couldn't be read (the
 * background passes that rewrite every game's user side skip rather than take it as disconnected).
 */
async function readAccounts(): Promise<{ names: string[]; failed: boolean }> {
  let failed = false;
  const read = async (username: () => Promise<string | undefined>) => {
    try {
      return (await username()) ?? null;
    } catch (error) {
      failed = true;
      logger.warn("game-puzzles", "reading a connected account failed:", errorMessage(error));
      return null;
    }
  };
  const names = await Promise.all([
    read(async () => (await getLichessAccountStore().status()).account?.username),
    read(async () => (await getChesscomAccountStore().account())?.username)
  ]);
  return { names: names.filter((name) => name !== null), failed };
}

/** The connected usernames that could be read. */
async function connectedUsernames(): Promise<string[]> {
  return (await readAccounts()).names;
}

/**
 * The connected usernames; null when an account couldn't be read (Insights' comparer and the
 * explorer's position index skip their pass then).
 */
export async function readConnectedUsernames(): Promise<string[] | null> {
  const { names, failed } = await readAccounts();
  return failed ? null : names;
}

/**
 * The queue, created once with the review hook on `engineManager`, and resumed (a persisted queue
 * carries on unless it was paused).
 */
export function startGamePuzzleQueue(engineManager: EngineManager): GamePuzzleQueue {
  if (queue) return queue;
  const evaluator = getMaia3Evaluator();
  queue = new GamePuzzleQueue({
    engine: defaultEngine,
    openEngine,
    maia: () =>
      evaluator.isInstalled()
        ? {
            evaluate: (queries, options) =>
              evaluator.evaluate(queries, { ...options, priority: "review" })
          }
        : null,
    openingBook,
    usernames: connectedUsernames,
    playerRatings: () => settingsRepository.getAll().playerRatings,
    engineIdleMs: () => engineManager.userEngineIdleMs(),
    emit: (event) => broadcast("gamePuzzles:progress", event)
  });
  noteReview = attachReviewHook(engineManager, queue);
  queue.start();
  return queue;
}

/** engines:reviewGame: the library game a review is of (the review hook queues it once done). */
export function noteReviewedGame(reviewId: string, gameId: string | null | undefined): void {
  noteReview?.(reviewId, gameId);
}

/** The engines changed (added, edited, removed, installed): a queue the engine stopped tries again. */
export function gamePuzzleEnginesChanged(): void {
  queue?.enginesChanged();
}

/** Quitting: the running game stops (it runs again next time). */
export async function stopGamePuzzleQueue(): Promise<void> {
  await queue?.stop();
}
