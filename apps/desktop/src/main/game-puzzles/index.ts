/**
 * Main's one puzzle generation queue (generation-queue.ts), wired to the app: the default engine
 * on its own UCI process (Threads 1, Hash from the engine settings), Maia 3 at review priority,
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

function defaultEngine(): { state: GamePuzzleEngineState; config: EngineConfig | null } {
  const config = engineRepository.list().find((engine) => engine.isDefault);
  if (!config || config.runtime === "maia3" || !existsSync(config.executablePath))
    return { state: "missing", config: null };
  return isLc0(config) ? { state: "lc0", config: null } : { state: "ready", config };
}

async function openEngine(config: EngineConfig, signal: AbortSignal): Promise<OpenedEngine> {
  const cancelled = () => signal.aborted;
  const session = new UciReviewSession(config, cancelled);
  try {
    await session.start({ multipv: 1, threads: 1, hashMb: engineResourceOptions().hashMb });
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

async function connectedUsernames(): Promise<string[]> {
  const read = async (username: () => Promise<string | undefined>) => {
    try {
      return (await username()) ?? null;
    } catch (error) {
      logger.warn("game-puzzles", "reading a connected account failed:", errorMessage(error));
      return null;
    }
  };
  const names = await Promise.all([
    read(async () => (await getLichessAccountStore().status()).account?.username),
    read(async () => (await getChesscomAccountStore().account())?.username)
  ]);
  return names.filter((name) => name !== null);
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
