/**
 * Study's explorer and the repertoire health check (docs/repertoire-games-and-practice.md §6),
 * wired to the app: the game position index (built at start, after a games sync, and whenever the
 * explorer asks, so a saved or imported game is read too), Maia 3, the Insights filters, and the
 * health queue on the default engine (it waits while the puzzle queue runs a game, and re-checks
 * a checked repertoire after its edits). Loaded after startup (index.ts), out of the main bundle.
 */
import { nearestMaia3Rating } from "@chaturanga/shared/engine/maia3";
import type {
  ExplorerGames,
  ExplorerMaiaInput,
  ExplorerMaiaMoves,
  ExplorerPositionInput
} from "@chaturanga/shared/types/repertoire-explorer";
import { getChesscomService } from "../chesscom";
import { settingsRepository } from "../db/repositories";
import type { EngineManager } from "../engine/engine-manager";
import { defaultEngine, openEngine, readConnectedUsernames } from "../game-puzzles";
import type { GamePuzzleQueue } from "../game-puzzles/generation-queue";
import { broadcast } from "../ipc/broadcast";
import { getLichessService } from "../lichess";
import { logger } from "../logger";
import { getMaia3Evaluator } from "../maia";
import { stripFingerprint } from "../repertoire/core";
import {
  chapterRepository,
  decisionRepository,
  repertoireRepository
} from "../repertoire/repository";
import { onRepertoireChanged } from "../repertoire/service-runtime";
import { insightsRepository } from "../repertoire-insights/repository";
import { explorerGames, explorerMaiaMoves, userRating, type UserRatingDeps } from "./explorer";
import { healthRepository } from "./health-repository";
import { RepertoireHealthQueue, type CheckedRepertoire } from "./health-queue";
import { GamePositionIndexer, gamePositionIndex } from "./position-index";

let indexer: GamePositionIndexer | null = null;
let healthQueue: RepertoireHealthQueue | null = null;

const ratingDeps: UserRatingDeps = {
  playerRatings: () => settingsRepository.getAll().playerRatings,
  ratingsSet: () => settingsRepository.getStored("playerRatings") !== undefined
};

function checkedRepertoire(id: string): CheckedRepertoire | null {
  const record = repertoireRepository.get(id);
  if (!record) return null;
  return {
    id,
    name: record.name,
    color: record.color,
    revision: record.revision,
    chapters: chapterRepository.list(id),
    decisions: decisionRepository.list(id).map(stripFingerprint)
  };
}

/** Quitting: the index stops between chunks, and the running check stops (it runs again next time). */
async function stopRepertoireExplorer(): Promise<void> {
  indexer?.stop();
  await healthQueue?.stop();
}

/** The explorer's side of the app: what its IPC handlers call, and quitting. */
export type RepertoireExplorer = {
  games(input: ExplorerPositionInput): ExplorerGames;
  maiaMoves(input: ExplorerMaiaInput): Promise<ExplorerMaiaMoves>;
  health: RepertoireHealthQueue;
  /** The stored health check results (health-repository.ts). */
  healthRepository: typeof healthRepository;
  stop(): Promise<void>;
};

/**
 * Starts the index and the health queue once (a persisted queue carries on unless it was paused).
 * `puzzles` is the puzzle queue the health check waits for.
 */
export function startRepertoireExplorer(
  engineManager: EngineManager,
  puzzles: Pick<GamePuzzleQueue, "status">
): RepertoireExplorer {
  const evaluator = getMaia3Evaluator();
  const index = (indexer ??= new GamePositionIndexer({ usernames: readConnectedUsernames }));
  const health = (healthQueue ??= new RepertoireHealthQueue({
    repertoire: checkedRepertoire,
    engine: defaultEngine,
    openEngine,
    maia: () =>
      evaluator.isInstalled()
        ? {
            evaluate: (queries, options) =>
              evaluator.evaluate(queries, { ...options, priority: "review" })
          }
        : null,
    rating: () => nearestMaia3Rating(userRating(ratingDeps).rating),
    engineIdleMs: () => engineManager.userEngineIdleMs(),
    puzzlesBusy: () => puzzles.status().current !== null,
    emit: (event) => broadcast("repertoireExplorer:healthProgress", event)
  }));
  // A finished sync, or another account: the index reads what changed.
  const kickAfter = (event: { type: string; running?: boolean }) => {
    if (event.type === "status" || (event.type === "sync" && !event.running)) index.kick();
  };
  getLichessService().on("event", kickAfter);
  getChesscomService().on("event", kickAfter);
  onRepertoireChanged((event) => {
    if (event.kind === "updated" && event.repertoireId) health.edited(event.repertoireId);
  });
  index.kick();
  try {
    health.start();
  } catch (error) {
    // The app starts without it (its database was busy): Run check starts it again.
    logger.error("repertoire-health", "the health queue didn't start:", error);
  }
  return {
    games: (input) => {
      index.kick();
      const progress = gamePositionIndex.progress();
      return explorerGames(
        input,
        insightsRepository.filters(),
        progress.done < progress.total ? progress : null
      );
    },
    maiaMoves: (input) => explorerMaiaMoves(input, evaluator, ratingDeps),
    health,
    healthRepository,
    stop: stopRepertoireExplorer
  };
}
