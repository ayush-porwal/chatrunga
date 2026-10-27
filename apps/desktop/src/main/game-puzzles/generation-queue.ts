/**
 * The puzzle generation queue (docs/puzzles-from-games.md, "The queue"): one game at a time, each
 * through chess/puzzle-generator.ts on its own engine process. It yields to the user: before every
 * search it waits while they use an engine elsewhere. Pausing stops the running game (no engine
 * process is left open) and puts it back first in line. Its games are persisted (db rows), so a
 * restart resumes it; a game that fails records its error and the queue moves on. An engine that
 * is missing or won't start stops the queue instead (no game is failed for it): the status says
 * why, and it tries again on Start, Resume, app start and when the engines change.
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
import { retryOnceIfBusy } from "../db/repositories";
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
/** After the queue's own database write failed (busy past its retry): wait, then carry on. */
const DRAIN_RETRY_MS = 5_000;

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

/** What one game came to: its result, `requeue` (stopped: it waits again), or `blocked` (no engine). */
type GameOutcome = GamePuzzleGameResult | "requeue" | "blocked";

export class GamePuzzleQueue {
  private paused: boolean;
  private stopped = false;
  private waitingForEngine = false;
  /** Why the queue stopped short of its games (the engine is missing or won't start), or null. */
  private problem: string | null = null;
  /** The loop working through the queue, while it runs. */
  private loop: Promise<void> | null = null;
  /** A kick that came while the loop ran: it looks again once it ends. */
  private kickAgain = false;
  /** Aborted when the app is closing: ends a wait before the queue tries again. */
  private readonly stopping = new AbortController();
  private job: AbortController | null = null;
  private current: GamePuzzleCurrentGame | null = null;
  private lastProgressAt = Number.NEGATIVE_INFINITY;
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
    this.stopping.abort();
    this.job?.abort(new Error("The app is closing."));
    const loop = this.loop;
    if (loop) await Promise.race([loop, sleep(STOP_WAIT_MS, undefined, { ref: false })]);
    repository.requeueRunning();
  }

  status(): GamePuzzleQueueStatus {
    return {
      paused: this.paused,
      waitingForEngine: this.waitingForEngine,
      problem: this.problem,
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

  /**
   * Queues the games `settings` match (newest first) and remembers them as the last used. Starting
   * from the dialog resumes a paused queue.
   */
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
    this.setPaused(false);
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
    const entries = scanFromReview(review, game.moves);
    const queued = repository.enqueue(
      [
        {
          gameId,
          source: "review",
          settings: { kinds, depth },
          scan: entries && { moves: [...game.moves], entries }
        }
      ],
      this.now()
    );
    if (!queued) return false;
    this.changed();
    this.kick();
    return true;
  }

  /**
   * Holds the queue (kept across restarts): the running game stops, its engine process closes, and
   * it goes back first in line to start again on resume.
   */
  pause(): GamePuzzleQueueStatus {
    this.setPaused(true);
    this.job?.abort(new Error("Puzzle generation was paused."));
    this.changed();
    return this.status();
  }

  /** Carries on (and tries the engine again when it was what stopped the queue). */
  resume(): GamePuzzleQueueStatus {
    this.setPaused(false);
    this.changed();
    this.kick();
    return this.status();
  }

  /**
   * Empties the queue; the game being processed is dropped (puzzles already found stay). An empty
   * queue is neither paused nor stopped.
   */
  cancel(): GamePuzzleQueueStatus {
    repository.cancelQueue();
    this.setPaused(false);
    this.problem = null;
    this.job?.abort(new Error("Puzzle generation was cancelled."));
    this.changed();
    return this.status();
  }

  /** The engines were added, edited or removed: a queue the engine stopped tries again. */
  enginesChanged(): void {
    if (this.problem !== null) this.kick();
  }

  private setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    repository.setPaused(paused);
  }

  /**
   * Starts working through the queue, unless it is paused or the app is closing. While the loop
   * runs, it looks once more after it ends (it may be ending just now: a game stopped, or the
   * engine missing).
   */
  private kick(): void {
    if (this.paused || this.stopped) return;
    if (this.loop) {
      this.kickAgain = true;
      return;
    }
    this.loop = this.drain()
      .catch((error: unknown) => this.drainFailed(error))
      .finally(() => {
        this.loop = null;
        if (!this.kickAgain) return;
        this.kickAgain = false;
        this.kick();
      });
  }

  /**
   * The queue's own database write failed (busy past its retry, as during a repertoire import):
   * the game goes back in line and the queue tries again shortly, instead of stopping until the
   * app restarts.
   */
  private drainFailed(error: unknown): void {
    logger.error("game-puzzles", "the queue stopped; it tries again shortly:", error);
    try {
      repository.requeueRunning();
    } catch (requeueError) {
      logger.warn("game-puzzles", "requeueing the game failed:", errorMessage(requeueError));
    }
    this.changed();
    this.wait(DRAIN_RETRY_MS, this.stopping.signal).then(
      () => this.kick(),
      () => undefined
    );
  }

  private async drain(): Promise<void> {
    while (!this.paused && !this.stopped) {
      const entry = await retryOnceIfBusy(() => repository.takeNext());
      if (!entry) {
        this.problem = null;
        return;
      }
      const outcome = await this.process(entry);
      if (outcome === "requeue" || outcome === "blocked") {
        // Back first in line (a cancelled game has already left the queue).
        await retryOnceIfBusy(() => repository.requeueRunning());
        this.changed();
        if (outcome === "blocked") return;
        continue;
      }
      await retryOnceIfBusy(() => repository.finish(outcome, this.now()));
      this.changed(outcome);
    }
  }

  /** The engine is missing or won't start: the queue stops, saying why (`problem`). */
  private blocked(problem: string): "blocked" {
    if (this.problem !== problem) logger.warn("game-puzzles", "the queue stopped:", problem);
    this.problem = problem;
    return "blocked";
  }

  /**
   * One game: its result, `requeue` when it was stopped (paused, cancelled, or the app is closing),
   * or `blocked` when the engine is missing or won't start.
   */
  private async process(entry: QueueEntry): Promise<GameOutcome> {
    const { gameId } = entry;
    const controller = new AbortController();
    this.job = controller;
    // Read anew after every await (paused, cancelled or closing meanwhile).
    const stopped = () => controller.signal.aborted;
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
      if (stopped()) return "requeue";
      if (!userSide || !game.moves.length) return ended("skipped");
      const { state, config } = this.deps.engine();
      if (!config) return this.blocked(ENGINE_PROBLEM[state === "lc0" ? "lc0" : "missing"]);
      let engine: OpenedEngine;
      try {
        engine = await this.deps.openEngine(config, controller.signal);
      } catch (error) {
        if (stopped()) return "requeue";
        return this.blocked(`${config.name} didn't start: ${errorMessage(error)}`);
      }
      if (this.problem !== null) {
        this.problem = null;
        this.changed();
      }
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
          // The game was edited since its review: its moves are searched again.
          scan: sameMoves(entry.scan?.moves, game.moves) ? entry.scan?.entries : null,
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
      if (stopped()) return "requeue";
      logger.warn("game-puzzles", `game ${gameId} failed:`, errorMessage(error));
      return ended("failed", 0, errorMessage(error));
    } finally {
      this.job = null;
      this.current = null;
      this.waitingForEngine = false;
    }
  }

  /** Before every search: waits while the user is using an engine (a pause aborts the game). */
  private async holdForUser(signal: AbortSignal): Promise<void> {
    for (;;) {
      signal.throwIfAborted();
      if (this.deps.engineIdleMs() < ENGINE_IDLE_MS) {
        this.setWaiting(true);
        await this.wait(ENGINE_POLL_MS, signal);
        continue;
      }
      this.setWaiting(false);
      return;
    }
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

function sameMoves(a: readonly string[] | undefined, b: readonly string[]): boolean {
  return a?.length === b.length && a.every((move, index) => move === b[index]);
}
