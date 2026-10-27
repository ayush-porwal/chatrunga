/**
 * The puzzle generation queue (docs/puzzles-from-games.md, "The queue"): one game at a time, each
 * through chess/puzzle-generator.ts on its own engine process. It yields to the user: before every
 * search it waits while they use an engine elsewhere, and while it is paused. Its games are
 * persisted (db rows), so a restart resumes it; a game that fails records its error and the queue
 * moves on.
 */
import type { EventEmitter } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import type { OpeningBook } from "@chaturanga/shared/chess/opening-book";
import {
  generateGamePuzzles,
  scanFromReview,
  userSideOfGame,
  type PuzzleEngine
} from "@chaturanga/shared/chess/puzzle-generator";
import type { PuzzleMaia } from "@chaturanga/shared/chess/puzzle-solution";
import { gameRatingMode, parseGameRating } from "@chaturanga/shared/chess/review-rating";
import type {
  EngineConfig,
  GameReview,
  ReviewCompleted,
  ReviewFailed
} from "@chaturanga/shared/types/engine";
import {
  GAME_PUZZLE_DEPTHS,
  type GamePuzzleCurrentGame,
  type GamePuzzleEngineState,
  type GamePuzzleGameCount,
  type GamePuzzleGameProgress,
  type GamePuzzleGameResult,
  type GamePuzzleGenerationEvent,
  type GamePuzzleQueueStatus,
  type GamePuzzleSettings,
  type GamePuzzleSummary
} from "@chaturanga/shared/types/game-puzzles";
import type { PlayerRatings } from "@chaturanga/shared/types/ratings";
import { errorMessage, logger } from "../logger";
import {
  gamePuzzleRepository as repository,
  type GenerationGame,
  type QueueEntry
} from "./repository";

/** The user's engine work counts as over once it has been idle this long (an engine game's moves). */
const ENGINE_IDLE_MS = 10_000;
/** How often a held search asks again whether the user's engine work is over. */
const ENGINE_POLL_MS = 1_000;
/** Progress through a game reaches the renderer at most this often (a new phase always does). */
const PROGRESS_INTERVAL_MS = 100;
/** How long quitting waits for the running game to stop (its process is killed after anyway). */
const STOP_WAIT_MS = 3_000;

const ENGINE_PROBLEM: Record<Exclude<GamePuzzleEngineState, "ready">, string> = {
  missing: "Finding puzzles needs a default engine such as Stockfish.",
  lc0: "Finding puzzles needs Stockfish or another UCI engine as the default engine (Lc0 is skipped)."
};

/** An engine process as the generator searches it; `close` ends the process. */
export type OpenedEngine = PuzzleEngine & { close(): void };

export type GamePuzzleQueueDeps = {
  /** The default engine and whether the queue can search with it. */
  engine(): { state: GamePuzzleEngineState; config: EngineConfig | null };
  /** Starts a process of `config` for one game (abandoned once `signal` aborts). */
  openEngine(config: EngineConfig, signal: AbortSignal): Promise<OpenedEngine>;
  /** Maia 3 when it is installed. */
  maia(): PuzzleMaia | null;
  openingBook(): OpeningBook | null;
  /** The connected Lichess and Chess.com usernames. */
  usernames(): Promise<string[]>;
  /** Settings → Ratings (a side without a game rating is read at the user's for the mode). */
  playerRatings(): PlayerRatings;
  /** How long the user's engine work has been idle (0 while it runs). */
  engineIdleMs(): number;
  emit(event: GamePuzzleGenerationEvent): void;
  generate?: typeof generateGamePuzzles;
  /** Resolves after `ms`; rejects once `signal` aborts. */
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
};

/** The rating Maia reads each side at: its game rating, else the user's for the game's mode. */
function sideRatings(
  game: GenerationGame,
  ratings: PlayerRatings
): { white: number; black: number } {
  const fallback = ratings[gameRatingMode(game.headers, game.source)].rating;
  return {
    white: parseGameRating(game.headers.whiteElo) ?? fallback,
    black: parseGameRating(game.headers.blackElo) ?? fallback
  };
}

const waitFor = (ms: number, signal: AbortSignal) => sleep(ms, undefined, { signal });

export class GamePuzzleQueue {
  private paused: boolean;
  private stopped = false;
  private waitingForEngine = false;
  /** The loop working through the queue, while it runs. */
  private loop: Promise<void> | null = null;
  private job: AbortController | null = null;
  private current: GamePuzzleCurrentGame | null = null;
  private lastProgressAt = Number.NEGATIVE_INFINITY;
  /** Searches held while paused, released by `resume`. */
  private resumeWaiters = new Set<() => void>();
  private readonly generate: typeof generateGamePuzzles;
  private readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly deps: GamePuzzleQueueDeps) {
    this.paused = repository.paused();
    this.generate = deps.generate ?? generateGamePuzzles;
    this.wait = deps.wait ?? waitFor;
    this.now = deps.now ?? Date.now;
  }

  /** App start: a game left running waits again, and the queue carries on (unless paused). */
  start(): void {
    repository.requeueRunning();
    this.kick();
  }

  /** Quitting: the running game stops (it runs again next time) and nothing more is written. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.job?.abort(new Error("The app is closing."));
    const loop = this.loop;
    if (loop) await Promise.race([loop, sleep(STOP_WAIT_MS, undefined, { ref: false })]);
    repository.requeueRunning();
  }

  status(): GamePuzzleQueueStatus {
    return {
      paused: this.paused,
      waitingForEngine: this.waitingForEngine,
      ...repository.batchCounts(),
      current: this.current
    };
  }

  async summary(): Promise<GamePuzzleSummary> {
    return {
      ...repository.summary(await this.deps.usernames(), this.now()),
      engine: this.deps.engine().state,
      maiaInstalled: this.deps.maia() !== null
    };
  }

  async countGames(settings: GamePuzzleSettings): Promise<GamePuzzleGameCount> {
    const { ids, withoutUserSide } = repository.matchingGames(
      settings,
      await this.deps.usernames()
    );
    return { eligible: ids.length, withoutUserSide };
  }

  /** Queues the games `settings` match (newest first) and remembers them as the last used. */
  async enqueueMatching(settings: GamePuzzleSettings): Promise<GamePuzzleQueueStatus> {
    const { state } = this.deps.engine();
    if (state !== "ready") throw new Error(ENGINE_PROBLEM[state]);
    if (!settings.kinds.length) throw new Error("Choose at least one kind of puzzle.");
    repository.setLastSettings(settings);
    const { ids } = repository.matchingGames(settings, await this.deps.usernames());
    const queued = { kinds: settings.kinds, depth: settings.depth };
    repository.enqueue(
      ids.map((gameId) => ({ gameId, source: "dialog", settings: queued, scan: null })),
      this.now()
    );
    this.changed();
    this.kick();
    return this.status();
  }

  /**
   * The review hook: a reviewed library game with a user side is queued with the review's
   * evaluations as its scan, for the last-used kinds and depth. Whether it was queued.
   */
  async enqueueReviewed(gameId: string, review: Pick<GameReview, "moves">): Promise<boolean> {
    if (this.stopped || this.deps.engine().state !== "ready") return false;
    const game = repository.generationGame(gameId);
    if (!game || !userSideOfGame(game, await this.deps.usernames())) return false;
    const { kinds, depth } = repository.lastSettings();
    if (!kinds.length) return false;
    const queued = repository.enqueue(
      [
        {
          gameId,
          source: "review",
          settings: { kinds, depth },
          scan: scanFromReview(review, game.moves)
        }
      ],
      this.now()
    );
    if (!queued) return false;
    this.changed();
    this.kick();
    return true;
  }

  /** Holds the queue after the current search (kept across restarts). */
  pause(): GamePuzzleQueueStatus {
    this.paused = true;
    repository.setPaused(true);
    this.changed();
    return this.status();
  }

  resume(): GamePuzzleQueueStatus {
    this.paused = false;
    repository.setPaused(false);
    for (const release of [...this.resumeWaiters]) release();
    this.changed();
    this.kick();
    return this.status();
  }

  /** Empties the queue; the game being processed is dropped (puzzles already found stay). */
  cancel(): GamePuzzleQueueStatus {
    repository.cancelQueue();
    this.job?.abort(new Error("Puzzle generation was cancelled."));
    this.changed();
    return this.status();
  }

  /** Starts working through the queue, unless it already is, is paused or the app is closing. */
  private kick(): void {
    if (this.loop || this.paused || this.stopped) return;
    this.loop = this.drain()
      .catch((error: unknown) => logger.error("game-puzzles", "the queue stopped:", error))
      .finally(() => {
        this.loop = null;
      });
  }

  private async drain(): Promise<void> {
    while (!this.paused && !this.stopped) {
      const entry = repository.takeNext();
      if (!entry) return;
      const result = await this.process(entry);
      if (result) repository.finish(result, this.now());
      this.changed(result);
    }
  }

  /** One game; null when it was stopped (cancelled, or the app is closing). */
  private async process(entry: QueueEntry): Promise<GamePuzzleGameResult | null> {
    const { gameId } = entry;
    const controller = new AbortController();
    this.job = controller;
    const ended = (
      status: GamePuzzleGameResult["status"],
      puzzlesFound = 0,
      error: string | null = null
    ): GamePuzzleGameResult => ({ gameId, status, puzzlesFound, error });
    try {
      const game = repository.generationGame(gameId);
      if (!game) return ended("skipped");
      this.current = {
        gameId,
        white: game.white,
        black: game.black,
        date: game.date,
        source: entry.source,
        progress: null
      };
      this.changed();
      const userSide = userSideOfGame(game, await this.deps.usernames());
      if (!userSide || !game.moves.length) return ended("skipped");
      const { state, config } = this.deps.engine();
      if (!config) throw new Error(ENGINE_PROBLEM[state === "lc0" ? "lc0" : "missing"]);
      const engine = await this.deps.openEngine(config, controller.signal);
      try {
        const puzzles = await this.generate({
          rootFen: game.rootFen,
          moves: game.moves,
          userSide,
          ratings: sideRatings(game, this.deps.playerRatings()),
          kinds: entry.settings.kinds,
          depths: GAME_PUZZLE_DEPTHS[entry.settings.depth],
          engine,
          maia: this.deps.maia(),
          openingBook: this.deps.openingBook(),
          // A scan for other moves (the game was edited since its review) is searched again.
          scan: entry.scan?.length === game.moves.length + 1 ? entry.scan : null,
          signal: controller.signal,
          onProgress: (progress) => this.progressed(progress),
          beforeSearch: () => this.holdForUser(controller.signal)
        });
        repository.savePuzzles(gameId, entry.settings.kinds, puzzles, this.now());
        return ended("done", puzzles.length);
      } finally {
        engine.close();
      }
    } catch (error) {
      if (controller.signal.aborted) return null;
      logger.warn("game-puzzles", `game ${gameId} failed:`, errorMessage(error));
      return ended("failed", 0, errorMessage(error));
    } finally {
      this.job = null;
      this.current = null;
      this.waitingForEngine = false;
    }
  }

  /** Before every search: waits while paused, and while the user is using an engine. */
  private async holdForUser(signal: AbortSignal): Promise<void> {
    for (;;) {
      signal.throwIfAborted();
      if (this.paused) {
        await this.untilResumed(signal);
        continue;
      }
      if (this.deps.engineIdleMs() < ENGINE_IDLE_MS) {
        this.setWaiting(true);
        await this.wait(ENGINE_POLL_MS, signal);
        continue;
      }
      this.setWaiting(false);
      return;
    }
  }

  private untilResumed(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const release = () => {
        signal.removeEventListener("abort", onAbort);
        this.resumeWaiters.delete(release);
        resolve();
      };
      const onAbort = () => {
        this.resumeWaiters.delete(release);
        reject(signal.reason);
      };
      this.resumeWaiters.add(release);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private setWaiting(waiting: boolean): void {
    if (this.waitingForEngine === waiting) return;
    this.waitingForEngine = waiting;
    this.changed();
  }

  private progressed(progress: GamePuzzleGameProgress): void {
    if (!this.current) return;
    const phase = this.current.progress?.phase;
    this.current = { ...this.current, progress };
    const now = this.now();
    if (phase === progress.phase && now - this.lastProgressAt < PROGRESS_INTERVAL_MS) return;
    this.lastProgressAt = now;
    this.changed();
  }

  private changed(finished: GamePuzzleGameResult | null = null): void {
    if (this.stopped) return;
    this.deps.emit({ status: this.status(), finished });
  }
}

/**
 * The review hook: `note` is told which library game a review is of when it starts
 * (engines:reviewGame, as the review events don't say); once that review completes, the game is
 * queued with its evaluations ({@link GamePuzzleQueue.enqueueReviewed}). The review code is not
 * touched: this only listens to its events.
 */
export function attachReviewHook(
  reviews: Pick<
    EventEmitter<{ reviewCompleted: [ReviewCompleted]; reviewFailed: [ReviewFailed] }>,
    "on"
  >,
  queue: Pick<GamePuzzleQueue, "enqueueReviewed">
): (reviewId: string, gameId: string | null | undefined) => void {
  const games = new Map<string, string>();
  reviews.on("reviewCompleted", ({ reviewId, review }) => {
    const gameId = games.get(reviewId);
    games.delete(reviewId);
    if (!gameId) return;
    queue
      .enqueueReviewed(gameId, review)
      .catch((error: unknown) =>
        logger.warn("game-puzzles", "queueing a reviewed game failed:", errorMessage(error))
      );
  });
  reviews.on("reviewFailed", ({ reviewId }) => games.delete(reviewId));
  return (reviewId, gameId) => {
    if (!gameId) return;
    games.set(reviewId, gameId);
    // A review that never reports back (it failed before starting) isn't kept for long.
    for (const stale of games.keys()) {
      if (games.size <= MAX_NOTED_REVIEWS) break;
      games.delete(stale);
    }
  };
}

/** Reviews noted at once (one runs at a time; a few may be waiting to report back). */
const MAX_NOTED_REVIEWS = 16;
