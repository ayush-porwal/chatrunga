import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import type {
  EngineBestMove,
  EngineConfig,
  EngineError,
  EngineInfo,
  EngineTestResult,
  ReviewCompleted,
  ReviewFailed,
  ReviewMoveCompleted,
  ReviewProgress,
  StartLiveAnalysisInput,
  StartEngineGameInput
} from "@chaturanga/shared/types/engine";
import { parseBestMove, parseInfoLine } from "@chaturanga/shared/engine/uci";
import { logger, errorMessage } from "../logger";
import { engineConfigForId, engineResourceOptions } from "./engine-config";
import { createLineSplitter, LOG_UCI, spawnUciProcess, stopUciProcess, writeUci } from "./uci-process";
import {
  createUciIdentity,
  isHumanPredictionEngine,
  readHandshakeLine,
  READYOK_TIMEOUT_MS,
  TEST_UCIOK_TIMEOUT_MS,
  UCIOK_TIMEOUT_MESSAGE,
  UCIOK_TIMEOUT_MS
} from "./uci-handshake";

export type EngineEvents = {
  info: [EngineInfo];
  bestmove: [EngineBestMove];
  error: [EngineError];
  reviewProgress: [ReviewProgress];
  reviewMoveCompleted: [ReviewMoveCompleted];
  reviewCompleted: [ReviewCompleted];
  reviewFailed: [ReviewFailed];
};

type LineWaiter = {
  predicate: (line: string) => boolean;
  resolve: () => void;
  reject: (error: Error) => void;
};


/** Throws when `config` can't be spawned as a native UCI process. */
export function assertSpawnable(config: EngineConfig | null): asserts config is EngineConfig {
  if (!config) throw new Error("Engine not found");
  if (!config.isAvailable) throw new Error("Engine binary is not available.");
}

/** How long a stopped process gets to exit by itself (after quit and SIGTERM) before it's killed. */
const EXIT_WAIT_MS = 2_000;
/** After SIGKILL, only a process stuck in the kernel (uninterruptible I/O) is still there this late. */
const KILL_WAIT_MS = 2_000;

/**
 * Resolves once `proc` has exited. One that ignores quit and SIGTERM is killed outright after
 * EXIT_WAIT_MS. The wait after that is bounded as well: a process the kernel can't reap yet would
 * otherwise hold up every later search for good.
 */
function processExited(proc: ChildProcessWithoutNullStreams): Promise<void> {
  // No pid: it never started (its spawn failed), so there is no exit to wait for.
  if (proc.pid === undefined || proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let timer = setTimeout(() => {
      proc.kill("SIGKILL");
      timer = setTimeout(() => {
        logger.warn("engine", `Engine process ${proc.pid} still running after SIGKILL`);
        resolve();
      }, KILL_WAIT_MS);
    }, EXIT_WAIT_MS);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function positionCommand(fen: string, moves: readonly string[]): string {
  return `position fen ${fen}${moves.length ? ` moves ${moves.join(" ")}` : ""}`;
}

/** An idle warm engine is shut down after this long (lc0 holds its network in memory). */
const IDLE_ENGINE_MS = 5 * 60_000;
/** How long a stopped search may take to report its bestmove before the process is replaced. */
const STOP_BESTMOVE_MS = 3_000;
/** Engine lines reach the renderer at most this often (~10 Hz); a bestmove flushes them first. */
export const ENGINE_INFO_INTERVAL_MS = 100;

type SearchKind = "game" | "analysis";

/** A running engine process that stays up between searches of the same kind and configuration. */
type EngineSession = {
  proc: ChildProcessWithoutNullStreams;
  config: EngineConfig;
  /** Reuse key: executable, args, weights, working directory, kind (and analysis resources). */
  key: string;
  supportedOptions: Set<string>;
  /** The search whose output is being relayed, or null between searches. */
  searchId: string | null;
  /** The last engine-game position searched: a continuation of it isn't a new game. */
  lastGame: GamePosition | null;
  multipv: number | null;
  /** The UCI handshake (`uci` … `uciok`, then Threads/Hash); searches wait for it. */
  ready: Promise<void>;
  /** The search this process was started for (its handshake errors belong to it). */
  owner: string;
};

type GamePosition = { gameKey?: string; fen: string; moves: readonly string[] };

class SupersededError extends Error {
  constructor() {
    super("Search superseded");
  }
}

/** True when `next` continues `previous`: the same game, same start, earlier moves unchanged. */
export function continuesGame(previous: GamePosition | null, next: GamePosition): boolean {
  if (!previous || previous.gameKey !== next.gameKey) return false;
  if (previous.fen !== next.fen || previous.moves.length > next.moves.length) return false;
  return previous.moves.every((move, index) => next.moves[index] === move);
}

/** Cancels kept for review jobs that aren't running (see `cancelReview`). */
const MAX_EARLY_REVIEW_CANCELS = 16;

/**
 * Owns the single interactive engine (engine games and live analysis) and relays its output as
 * typed events tagged with the search they belong to. The process stays warm between searches
 * (no respawn and handshake — for lc0, no network reload — on every move or position); it is
 * replaced when the engine or its configuration changes, and shut down after a quiet spell.
 * Searches run one at a time, in order; one superseded by a newer request is dropped. Game
 * review and draw probes run their own short-lived processes.
 */
export class EngineManager extends EventEmitter<EngineEvents> {
  private session: EngineSession | null = null;
  private lineWaiter: LineWaiter | null = null;
  /** The newest requested search; older ones still queued are skipped, running ones stopped. */
  private latestSearchId: string | null = null;
  private queue: Promise<void> = Promise.resolve();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingInfos = new Map<number, EngineInfo>();
  private infoTimer: ReturnType<typeof setTimeout> | null = null;
  /** Cancels of running review jobs (cleared when each finishes). */
  private cancelledReviewIds = new Set<string>();
  /**
   * Cancels of jobs that aren't running: kept for one about to start (its cancel can reach main
   * before its request), but a cancel sent after its job finished is never cleared — so only the
   * latest few are kept, the oldest dropped first.
   */
  private earlyCancelledReviewIds = new Set<string>();
  private activeReviewIds = new Set<string>();
  /** Waits of the running search that a newer request (or a stop) interrupts. */
  private supersedeListeners = new Set<() => void>();
  /** The exit of the last process shut down: a replacement starts only after it (lc0's network). */
  private lastExit: Promise<void> = Promise.resolve();

  cancelReview(reviewId: string): void {
    if (this.activeReviewIds.has(reviewId)) {
      this.cancelledReviewIds.add(reviewId);
      return;
    }
    this.earlyCancelledReviewIds.delete(reviewId);
    this.earlyCancelledReviewIds.add(reviewId);
    for (const stale of this.earlyCancelledReviewIds) {
      if (this.earlyCancelledReviewIds.size <= MAX_EARLY_REVIEW_CANCELS) break;
      this.earlyCancelledReviewIds.delete(stale);
    }
  }

  isReviewCancelled(reviewId: string): boolean {
    return this.cancelledReviewIds.has(reviewId) || this.earlyCancelledReviewIds.has(reviewId);
  }

  clearReviewCancellation(reviewId: string): void {
    this.cancelledReviewIds.delete(reviewId);
    this.earlyCancelledReviewIds.delete(reviewId);
  }

  /** A review job started / finished (so closing the window can cancel what's running). */
  trackReview(reviewId: string, active: boolean): void {
    if (active) this.activeReviewIds.add(reviewId);
    else this.activeReviewIds.delete(reviewId);
  }

  cancelAllReviews(): void {
    for (const reviewId of this.activeReviewIds) this.cancelReview(reviewId);
  }

  /** Spawns the engine, waits for `uciok` and reports its id. */
  async testEngine(idOrConfig: string | EngineConfig): Promise<EngineTestResult> {
    const config = typeof idOrConfig === "string" ? engineConfigForId(idOrConfig) : idOrConfig;
    try {
      assertSpawnable(config);
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }

    return new Promise((resolve) => {
      const proc = spawnUciProcess(config);
      const identity = createUciIdentity();
      let settled = false;
      const finish = (result: EngineTestResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        stopUciProcess(proc);
        resolve(result);
      };
      const timeout = setTimeout(
        () => finish({ ok: false, error: "Timed out waiting for uciok (NN engines such as lc0 may need --weights)" }),
        TEST_UCIOK_TIMEOUT_MS
      );

      proc.stdout.on(
        "data",
        createLineSplitter((line) => {
          if (!readHandshakeLine(identity, line)) return;
          finish({
            ok: true,
            name: identity.name,
            author: identity.author,
            isHumanPrediction: isHumanPredictionEngine(identity)
          });
        })
      );
      proc.on("exit", (code, signal) =>
        finish({
          ok: false,
          error: signal
            ? "Engine exited during handshake (terminated)."
            : `Engine exited during handshake (code ${code ?? 0}). Check args and weights path.`
        })
      );
      proc.on("error", (error) => finish({ ok: false, error: error.message }));
      writeUci(proc, "uci");
    });
  }

  /** Searches for the engine's move in an engine game. */
  start(input: StartEngineGameInput): Promise<void> {
    return this.search("game", input.engineId, input.searchId, (session) => {
      // A new game (or a position that doesn't continue the last one) resets the engine's state.
      if (!continuesGame(session.lastGame, input)) this.write("ucinewgame");
      session.lastGame = { gameKey: input.gameKey, fen: input.fen, moves: [...input.moves] };
      return () => {
        this.write(positionCommand(input.fen, input.moves));
        if (input.clock) {
          const { wtime, btime, winc, binc } = input.clock;
          this.write(
            `go wtime ${Math.max(1, Math.round(wtime))} btime ${Math.max(1, Math.round(btime))} ` +
              `winc ${Math.max(0, Math.round(winc))} binc ${Math.max(0, Math.round(binc))}`
          );
        } else if (input.depth) this.write(`go depth ${input.depth}`);
        else this.write(`go movetime ${input.moveTimeMs ?? 1000}`);
      };
    });
  }

  /**
   * Starts a MultiPV search for the live analysis panel: until stopped, or to the depth / for the
   * time asked for (its best move then ends it).
   */
  startAnalysis(input: StartLiveAnalysisInput): Promise<void> {
    const multipv = Math.max(1, Math.min(Math.round(input.multipv ?? 3), 5));
    return this.search("analysis", input.engineId, input.searchId, (session) => {
      if (session.multipv !== multipv && session.supportedOptions.has("MultiPV")) {
        this.write(`setoption name MultiPV value ${multipv}`);
        session.multipv = multipv;
      }
      return () => {
        this.write(positionCommand(input.fen, input.moves));
        if (input.depth) this.write(`go depth ${input.depth}`);
        else if (input.moveTimeMs) this.write(`go movetime ${input.moveTimeMs}`);
        else this.write("go infinite");
      };
    });
  }

  /** Ends the running search (the process stays warm for the next one). */
  stop(): Promise<void> {
    this.latestSearchId = null;
    this.supersede();
    this.discardInfos();
    const job = this.queue.then(() => this.stopSearch());
    this.queue = job.catch(() => undefined);
    return job;
  }

  /**
   * Ends any search and shuts the engine process down (window closed, quit, or before another
   * process of an engine runs: lc0 can't hold its network in memory twice). Resolves once it exited.
   */
  dispose(): Promise<void> {
    this.latestSearchId = null;
    this.supersede();
    return this.killSession();
  }

  /**
   * Runs `work` (a draw probe's own engine process) with the engine to itself: it starts once the
   * warm process has exited, and searches requested meanwhile start after it finished.
   */
  runExclusive<T>(work: () => Promise<T>): Promise<T> {
    const exited = this.dispose();
    const job = this.queue.then(() => exited).then(work);
    this.queue = job.then(
      () => undefined,
      () => undefined
    );
    return job;
  }

  /** The running search is no longer wanted: its waits (startup, isready) end now. */
  private supersede(): void {
    for (const listener of [...this.supersedeListeners]) listener();
  }

  /** `work`, unless a newer request arrives first (then SupersededError; `work` carries on). */
  private untilSuperseded<T>(work: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const onSuperseded = () => reject(new SupersededError());
      this.supersedeListeners.add(onSuperseded);
      work.then(resolve, reject).finally(() => this.supersedeListeners.delete(onSuperseded));
    });
  }

  /**
   * Shuts the process down; resolves once it exited (or, with none running, once the last one
   * shut down has). A queued search still starts a fresh one, after that exit.
   */
  private killSession(): Promise<void> {
    this.discardInfos();
    this.clearIdleTimer();
    this.rejectLineWaiter("Engine stopped");
    const session = this.session;
    this.session = null;
    if (!session) return this.lastExit;
    const exited = processExited(session.proc);
    writeUci(session.proc, "stop");
    stopUciProcess(session.proc);
    this.lastExit = exited;
    return exited;
  }

  private search(
    kind: SearchKind,
    engineId: string,
    searchId: string,
    prepare: (session: EngineSession) => () => void
  ): Promise<void> {
    this.latestSearchId = searchId;
    this.supersede();
    this.clearIdleTimer();
    const job = this.queue.then(() => this.runSearch(kind, engineId, searchId, prepare));
    this.queue = job.catch(() => undefined);
    return job;
  }

  private async runSearch(
    kind: SearchKind,
    engineId: string,
    searchId: string,
    prepare: (session: EngineSession) => () => void
  ): Promise<void> {
    const current = () => {
      if (this.latestSearchId !== searchId) throw new SupersededError();
    };
    try {
      current();
      const config = engineConfigForId(engineId);
      assertSpawnable(config);
      await this.stopSearch();
      current();
      const session = await this.ensureSession(config, kind, searchId);
      // A slow startup (lc0 loading its network) doesn't hold up a newer request: it keeps
      // going in the background, and a newer search of the same engine picks it up.
      await this.untilSuperseded(session.ready);
      current();
      const begin = prepare(session);
      await this.untilSuperseded(this.waitForReady());
      current();
      this.discardInfos();
      session.searchId = searchId;
      begin();
    } catch (error) {
      // A newer search (or a stop) replaced this one: expected, not an error to report.
      if (error instanceof SupersededError || this.latestSearchId !== searchId) return;
      this.emit("error", { engineId, searchId, message: errorMessage(error) });
      this.killSession();
      throw error;
    }
  }

  /**
   * The warm process if it fits `config` and `kind`, else a fresh one (its handshake in `ready`),
   * started once the process it replaces has exited.
   */
  private async ensureSession(config: EngineConfig, kind: SearchKind, searchId: string): Promise<EngineSession> {
    const resources = kind === "analysis" ? engineResourceOptions() : null;
    const key = JSON.stringify([
      config.id,
      config.executablePath,
      config.args,
      config.weightsPath,
      config.workingDirectory,
      kind,
      resources
    ]);
    const existing = this.session;
    if (existing && existing.key === key && existing.proc.exitCode === null && !existing.proc.killed) return existing;
    await this.killSession();
    // A newer request (or a stop) came in while the old process was exiting: don't start this one.
    if (this.latestSearchId !== searchId) throw new SupersededError();

    const proc = spawnUciProcess(config);
    const session: EngineSession = {
      proc,
      config,
      key,
      supportedOptions: new Set(),
      searchId: null,
      lastGame: null,
      multipv: null,
      ready: Promise.resolve(),
      owner: searchId
    };
    this.session = session;
    proc.stdout.on("data", createLineSplitter((line) => this.handleLine(session, line)));
    proc.stderr.on("data", (chunk: Buffer) => {
      if (LOG_UCI) logger.info(`uci:${config.name}`, "[stderr]", chunk.toString("utf8").trim());
    });
    proc.on("error", (error) => {
      if (this.session !== session) return;
      // Tagged with the search it hurts: the running one, else the one this process was started for.
      this.emit("error", { engineId: config.id, searchId: session.searchId ?? session.owner, message: error.message });
    });
    proc.on("exit", (code) => {
      if (this.session !== session) return;
      this.session = null;
      this.rejectLineWaiter(
        `Engine exited${code !== null ? ` (exit ${code})` : ""}. For lc0 set the weights file in settings or add --weights=/path/to/net.pb.gz in args.`
      );
    });

    session.ready = (async () => {
      const identity = createUciIdentity();
      identity.options = session.supportedOptions;
      const uciOk = this.waitForLine((line) => readHandshakeLine(identity, line), UCIOK_TIMEOUT_MS, UCIOK_TIMEOUT_MESSAGE);
      this.write("uci");
      await uciOk;
      if (resources) {
        // Same Threads/Hash settings as Game Review; only for engines that advertise them.
        if (session.supportedOptions.has("Threads")) this.write(`setoption name Threads value ${resources.threads}`);
        if (session.supportedOptions.has("Hash")) this.write(`setoption name Hash value ${resources.hashMb}`);
      }
    })();
    // A failed startup nobody waits for any more (superseded) still ends that process.
    session.ready.catch(() => {
      if (this.session === session) this.killSession();
    });
    return session;
  }

  /** Stops the running search and waits for its (discarded) bestmove, so the next one starts clean. */
  private async stopSearch(): Promise<void> {
    const session = this.session;
    if (!session?.searchId) {
      this.scheduleIdleShutdown();
      return;
    }
    session.searchId = null;
    const stopped = this.waitForLine((line) => line.startsWith("bestmove"), STOP_BESTMOVE_MS, "stop timed out");
    this.write("stop");
    try {
      await stopped;
    } catch {
      // No bestmove: the engine is stuck (or it had just sent one). Start over with a new process.
      if (this.session === session) this.killSession();
    }
    this.scheduleIdleShutdown();
  }

  private async waitForReady(): Promise<void> {
    const readyOk = this.waitForLine((line) => line === "readyok", READYOK_TIMEOUT_MS, "Timed out waiting for readyok after isready.");
    this.write("isready");
    await readyOk;
  }

  private scheduleIdleShutdown(): void {
    this.clearIdleTimer();
    if (!this.session) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.session?.searchId) this.killSession();
    }, IDLE_ENGINE_MS);
    this.idleTimer.unref?.();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private write(command: string): void {
    const session = this.session;
    if (!session) return;
    if (LOG_UCI) logger.info(`uci:${session.config.name}`, "→", command);
    writeUci(session.proc, command);
  }

  private waitForLine(predicate: (line: string) => boolean, timeoutMs: number, timeoutMessage: string): Promise<void> {
    this.rejectLineWaiter("Superseded");
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => settle(new Error(timeoutMessage)), timeoutMs);
      const settle = (error?: Error) => {
        clearTimeout(timeout);
        if (this.lineWaiter === waiter) this.lineWaiter = null;
        if (error) reject(error);
        else resolve();
      };
      const waiter: LineWaiter = { predicate, resolve: () => settle(), reject: settle };
      this.lineWaiter = waiter;
    });
  }

  private rejectLineWaiter(reason: string): void {
    this.lineWaiter?.reject(new Error(reason));
  }

  private handleLine(session: EngineSession, line: string): void {
    if (this.session !== session) return;
    const engine = session.config;
    if (LOG_UCI) logger.info(`uci:${engine.name}`, "←", line);

    if (this.lineWaiter?.predicate(line)) {
      this.lineWaiter.resolve();
      return;
    }
    const searchId = session.searchId;
    if (!searchId) return;
    const bestMove = parseBestMove(engine.id, line);
    if (bestMove) {
      session.searchId = null;
      this.flushInfos();
      this.emit("bestmove", { ...bestMove, searchId });
      this.scheduleIdleShutdown();
      return;
    }
    const info = parseInfoLine(engine.id, line);
    if (info) this.queueInfo({ ...info, searchId });
  }

  /** Keeps the newest line per MultiPV slot and relays them together, ~10 times a second. */
  private queueInfo(info: EngineInfo): void {
    this.pendingInfos.set(info.multipv ?? 1, info);
    if (this.infoTimer) return;
    this.infoTimer = setTimeout(() => this.flushInfos(), ENGINE_INFO_INTERVAL_MS);
  }

  private flushInfos(): void {
    if (this.infoTimer) clearTimeout(this.infoTimer);
    this.infoTimer = null;
    const infos = [...this.pendingInfos.values()];
    this.pendingInfos.clear();
    for (const info of infos) this.emit("info", info);
  }

  private discardInfos(): void {
    if (this.infoTimer) clearTimeout(this.infoTimer);
    this.infoTimer = null;
    this.pendingInfos.clear();
  }
}
