/**
 * The repertoire health queue (docs/repertoire-games-and-practice.md §6.3): one repertoire at a
 * time, on Run check and after an edit to a repertoire checked before (debounced 30 s). The
 * no-answer flags need no engine and are written at once; the engine pass runs here on the default
 * engine's own process, with the puzzle queue's rules: before every search it waits while the user
 * uses an engine elsewhere, and while the puzzle queue runs a game (one engine-heavy queue at a
 * time); a wait longer than 10 s closes the process, and the next search starts it again. Pausing stops the running check (its engine process closes) and puts it back first in
 * line; the queue is persisted, so a restart resumes it. A missing default engine, Lc0, or an
 * engine that won't start stops the queue, saying why (`problem`); it tries again on Run check,
 * Resume and app start.
 */
import { setTimeout as sleep } from "node:timers/promises";
import type { PuzzleEngine } from "@chaturanga/shared/chess/puzzle-generator";
import type { PuzzleEngineSearch } from "@chaturanga/shared/chess/puzzle-solution";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import type { GamePuzzleEngineState } from "@chaturanga/shared/types/game-puzzles";
import type {
  RepertoireHealthCurrent,
  RepertoireHealthEvent,
  RepertoireHealthQueueStatus
} from "@chaturanga/shared/types/repertoire-health";
import type { Maia3Evaluator } from "@chaturanga/shared/engine/maia3";
import { retryOnceIfBusy } from "../db/repositories";
import type { OpenedEngine } from "../game-puzzles/generation-queue";
import { errorMessage, logger } from "../logger";
import { engineFlags, healthPositions, type HealthRepertoire } from "./health-check";
import { healthRepository as repository } from "./health-repository";

/** The user's engine work counts as over once it has been idle this long (as for puzzles). */
const ENGINE_IDLE_MS = 10_000;
/** How often a held search asks again. */
const POLL_MS = 1_000;
/** A search held this many looks (10 s) closes the engine process until it can go on. */
const HOLD_OPEN_POLLS = 10;
/** An edit to a checked repertoire checks it again after this long without another edit. */
export const EDIT_DEBOUNCE_MS = 30_000;
/** Progress reaches the renderer at most this often. */
const PROGRESS_INTERVAL_MS = 250;
/** How long quitting waits for the running check to stop. */
const STOP_WAIT_MS = 3_000;
/** After the queue's own database write failed (busy past its retry): wait, then carry on. */
const DRAIN_RETRY_MS = 5_000;

const ENGINE_PROBLEM: Record<Exclude<GamePuzzleEngineState, "ready">, string> = {
  missing: "The health check needs a default engine such as Stockfish.",
  lc0: "The health check needs Stockfish or another UCI engine as the default engine (Lc0 is skipped)."
};

/** A repertoire as the check reads it. */
export type CheckedRepertoire = HealthRepertoire & { id: string; name: string; revision: number };

type RepertoireHealthQueueDeps = {
  /** The repertoire to check; null when it is gone. */
  repertoire(id: string): CheckedRepertoire | null;
  /** The default engine and whether the check can search with it (the puzzle queue's rule). */
  engine(): { state: GamePuzzleEngineState; config: EngineConfig | null };
  /** Starts a process of `config` for one check (abandoned once `signal` aborts). */
  openEngine(config: EngineConfig, signal: AbortSignal): Promise<OpenedEngine>;
  /** Maia 3 when it is installed. */
  maia(): Pick<Maia3Evaluator, "evaluate"> | null;
  /** The user's rating Maia reads both sides at. */
  rating(): number;
  /** How long the user's engine work has been idle (0 while it runs). */
  engineIdleMs(): number;
  /** Whether the puzzle queue is running a game. */
  puzzlesBusy(): boolean;
  emit(event: RepertoireHealthEvent): void;
  /** Resolves after `ms`; rejects once `signal` aborts. */
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  /** Timers for the after-edit debounce (tests). */
  setTimer?: (run: () => void, ms: number) => { cancel(): void };
};

const waitFor = (ms: number, signal: AbortSignal) => sleep(ms, undefined, { signal });

function nodeTimer(run: () => void, ms: number): { cancel(): void } {
  const handle = setTimeout(run, ms);
  handle.unref();
  return { cancel: () => clearTimeout(handle) };
}

/**
 * One check's engine process: started for the check, closed while the check waits long for the
 * user or the puzzle queue, and started again for the next search.
 */
class CheckEngine implements PuzzleEngine {
  private opened: OpenedEngine | null = null;

  constructor(private readonly open: () => Promise<OpenedEngine>) {}

  async start(): Promise<OpenedEngine> {
    if (!this.opened) this.opened = await this.open();
    return this.opened;
  }

  async analyse(fen: string, search: PuzzleEngineSearch) {
    return (await this.start()).analyse(fen, search);
  }

  close(): void {
    this.opened?.close();
    this.opened = null;
  }
}

/** What one check came to: done, `requeue` (stopped: it waits again), or `blocked` (no engine). */
type CheckOutcome = { error: string | null; revision: number | null } | "requeue" | "blocked";

export class RepertoireHealthQueue {
  private paused: boolean;
  private stopped = false;
  private waitingForEngine = false;
  private waitingForPuzzles = false;
  private problem: string | null = null;
  private loop: Promise<void> | null = null;
  private kickAgain = false;
  private readonly stopping = new AbortController();
  private job: AbortController | null = null;
  private current: RepertoireHealthCurrent | null = null;
  private lastProgressAt = Number.NEGATIVE_INFINITY;
  private readonly edits = new Map<string, { cancel(): void }>();
  /** Edits whose checks are being queued. */
  private readonly queueing = new Set<Promise<void>>();
  private readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly now: () => number;
  private readonly setTimer: (run: () => void, ms: number) => { cancel(): void };

  constructor(private readonly deps: RepertoireHealthQueueDeps) {
    this.paused = repository.paused();
    this.wait = deps.wait ?? waitFor;
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? nodeTimer;
  }

  /** App start: a check left running waits again, and the queue carries on (unless paused). */
  start(): void {
    repository.requeueRunning();
    this.kick();
  }

  /** Resolves once the queue has stopped working, edits queued included (tests). */
  async idle(): Promise<void> {
    while (this.loop || this.queueing.size) await Promise.all([this.loop, ...this.queueing]);
  }

  /** Quitting: the running check stops (it runs again next time); pending edits are dropped. */
  async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.edits.values()) timer.cancel();
    this.edits.clear();
    this.stopping.abort();
    this.job?.abort(new Error("The app is closing."));
    const loop = this.loop;
    if (loop) await Promise.race([loop, sleep(STOP_WAIT_MS, undefined, { ref: false })]);
    repository.requeueRunning();
  }

  status(): RepertoireHealthQueueStatus {
    return {
      paused: this.paused,
      waitingForEngine: this.waitingForEngine,
      waitingForPuzzles: this.waitingForPuzzles,
      problem: this.problem,
      queued: repository.queued(),
      current: this.current
    };
  }

  /**
   * Run check: the no-answer flags of each repertoire are written now, and its engine pass is
   * queued. Starting a check resumes a paused queue.
   */
  async check(repertoireIds: readonly string[]): Promise<RepertoireHealthQueueStatus> {
    await this.queueChecks(repertoireIds);
    this.setPaused(false);
    this.problem = null;
    this.changed();
    this.kick();
    return this.status();
  }

  /**
   * A repertoire changed: one checked before is checked again once its edits settle (30 s after
   * the last). A paused queue stays paused.
   */
  edited(repertoireId: string): void {
    if (this.stopped || !repository.checkedBefore(repertoireId)) return;
    this.edits.get(repertoireId)?.cancel();
    this.edits.set(
      repertoireId,
      this.setTimer(() => {
        this.edits.delete(repertoireId);
        const queueing = this.queueChecks([repertoireId])
          .then(() => {
            this.changed();
            this.kick();
          })
          .catch((error: unknown) =>
            logger.warn("repertoire-health", "checking an edit failed:", errorMessage(error))
          )
          .finally(() => this.queueing.delete(queueing));
        this.queueing.add(queueing);
      }, EDIT_DEBOUNCE_MS)
    );
  }

  /** Holds the queue (kept across restarts): the running check stops and goes back first in line. */
  pause(): RepertoireHealthQueueStatus {
    this.setPaused(true);
    this.job?.abort(new Error("The health check was paused."));
    this.changed();
    return this.status();
  }

  /** Carries on (and tries the engine again when it was what stopped the queue). */
  resume(): RepertoireHealthQueueStatus {
    this.setPaused(false);
    this.problem = null;
    this.changed();
    this.kick();
    return this.status();
  }

  /** Empties the queue; the running check stops (flags already stored stay). */
  cancel(): RepertoireHealthQueueStatus {
    repository.cancelQueue();
    this.setPaused(false);
    this.problem = null;
    this.job?.abort(new Error("The health check was cancelled."));
    this.changed();
    return this.status();
  }

  /** Writes the no-answer flags of each repertoire and queues its engine pass. */
  private async queueChecks(repertoireIds: readonly string[]): Promise<void> {
    const now = this.now();
    for (const id of repertoireIds) {
      const repertoire = this.deps.repertoire(id);
      if (!repertoire) continue;
      const { noAnswer } = healthPositions(repertoire);
      await retryOnceIfBusy(() =>
        repository.replaceFlags({
          repertoireId: id,
          kinds: ["no-answer"],
          flags: noAnswer,
          revision: repertoire.revision,
          now
        })
      );
      this.changed(id);
    }
    await retryOnceIfBusy(() => repository.enqueue(repertoireIds, now));
  }

  private setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    repository.setPaused(paused);
  }

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

  private drainFailed(error: unknown): void {
    logger.error("repertoire-health", "the queue stopped; it tries again shortly:", error);
    try {
      repository.requeueRunning();
    } catch (requeueError) {
      logger.warn("repertoire-health", "requeueing failed:", errorMessage(requeueError));
    }
    this.changed();
    this.wait(DRAIN_RETRY_MS, this.stopping.signal).then(
      () => this.kick(),
      () => undefined
    );
  }

  private async drain(): Promise<void> {
    while (!this.paused && !this.stopped) {
      const id = await retryOnceIfBusy(() => repository.takeNext());
      if (!id) return;
      const outcome = await this.process(id);
      if (outcome === "requeue" || outcome === "blocked") {
        await retryOnceIfBusy(() => repository.requeueRunning());
        this.changed();
        if (outcome === "blocked") return;
        continue;
      }
      await retryOnceIfBusy(() =>
        repository.finish(id, outcome.revision, outcome.error, this.now())
      );
      this.changed(id);
    }
  }

  private blocked(problem: string): "blocked" {
    if (this.problem !== problem) logger.warn("repertoire-health", "the queue stopped:", problem);
    this.problem = problem;
    return "blocked";
  }

  /** One repertoire's engine pass. */
  private async process(id: string): Promise<CheckOutcome> {
    const controller = new AbortController();
    this.job = controller;
    const stopped = () => controller.signal.aborted;
    try {
      const repertoire = this.deps.repertoire(id);
      if (!repertoire) return { error: null, revision: null };
      const { state, config } = this.deps.engine();
      if (!config) return this.blocked(ENGINE_PROBLEM[state === "lc0" ? "lc0" : "missing"]);
      this.current = { repertoireId: id, name: repertoire.name, done: 0, total: 0 };
      this.changed();
      // Not even a process while the user or the puzzle queue is using an engine.
      await this.holdForOthers(controller.signal);
      const engine = new CheckEngine(() => this.deps.openEngine(config, controller.signal));
      try {
        await engine.start();
      } catch (error) {
        if (stopped()) return "requeue";
        return this.blocked(`${config.name} didn't start: ${errorMessage(error)}`);
      }
      if (this.problem !== null) {
        this.problem = null;
        this.changed();
      }
      try {
        const flags = await engineFlags({
          positions: healthPositions(repertoire),
          engine,
          maia: this.deps.maia(),
          rating: this.deps.rating(),
          signal: controller.signal,
          beforeSearch: () => this.holdForOthers(controller.signal, () => engine.close()),
          onProgress: (done, total) => this.progressed(done, total)
        });
        await retryOnceIfBusy(() =>
          repository.replaceFlags({
            repertoireId: id,
            kinds: ["engine-disagrees", "common-mistake"],
            flags,
            revision: repertoire.revision,
            now: this.now()
          })
        );
        return { error: null, revision: repertoire.revision };
      } finally {
        engine.close();
      }
    } catch (error) {
      if (stopped()) return "requeue";
      logger.warn("repertoire-health", `checking ${id} failed:`, errorMessage(error));
      return { error: errorMessage(error), revision: null };
    } finally {
      this.job = null;
      this.current = null;
      this.setWaiting(false, false);
    }
  }

  /**
   * Waits while the user is using an engine or the puzzle queue runs a game; `heldLong` runs once
   * the wait passes 10 s.
   */
  private async holdForOthers(signal: AbortSignal, heldLong?: () => void): Promise<void> {
    for (let polls = 0; ; polls += 1) {
      signal.throwIfAborted();
      const engineBusy = this.deps.engineIdleMs() < ENGINE_IDLE_MS;
      const puzzlesBusy = !engineBusy && this.deps.puzzlesBusy();
      this.setWaiting(engineBusy, puzzlesBusy);
      if (!engineBusy && !puzzlesBusy) return;
      if (polls === HOLD_OPEN_POLLS) heldLong?.();
      await this.wait(POLL_MS, signal);
    }
  }

  private setWaiting(engine: boolean, puzzles: boolean): void {
    if (this.waitingForEngine === engine && this.waitingForPuzzles === puzzles) return;
    this.waitingForEngine = engine;
    this.waitingForPuzzles = puzzles;
    this.changed();
  }

  private progressed(done: number, total: number): void {
    if (!this.current) return;
    this.current = { ...this.current, done, total };
    const now = this.now();
    if (done !== 0 && done !== total && now - this.lastProgressAt < PROGRESS_INTERVAL_MS) return;
    this.lastProgressAt = now;
    this.changed();
  }

  private changed(flagsChanged: string | null = null): void {
    if (this.stopped) return;
    this.deps.emit({ status: this.status(), flagsChanged });
  }
}
