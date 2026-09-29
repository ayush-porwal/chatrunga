import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  GAME_REVIEW_SCHEMA_VERSION,
  type AnalysisLine,
  type EngineConfig,
  type EngineInfo,
  type GameReview,
  type GameReviewSummary,
  type MaiaRating,
  type MoveClassification,
  type MoveReview,
  type RatingPrediction,
  type ReviewGameInput,
  type ReviewMoveInputItem,
  type ReviewProgressPhase,
  type TerminalState,
  type Wdl
} from "@chaturanga/shared/types/engine";
import { statusForFen } from "@chaturanga/shared/chess/position";
import {
  classifyMove,
  scoreFromWhitePerspective,
  standardCastlingUci,
  terminalStateForFen
} from "@chaturanga/shared/chess/review";
import { parseInfoLine, parseLc0MoveStat, type Lc0MoveStat } from "@chaturanga/shared/engine/uci";
import { logger } from "../logger";
import {
  resolveReviewSearchParams,
  reviewAnalysisTimeoutMs,
  type ResolvedReviewSearch
} from "./review-search";
import {
  buildRatingPrediction,
  computeEvalLoss,
  linesFromInfoStream,
  nearestRatingBucket,
  parseClock,
  parseTimeControl,
  tacticalMotifsForBestMove,
  terminalScore,
  terminalWdl,
  timeSpentForMove
} from "./review-analysis";
import { createLineSplitter, LOG_UCI, spawnUciProcess, stopUciProcess, writeUci } from "./uci-process";
import { moveKey, ReviewCache } from "./review-cache";

type LineEvents = {
  line: [string];
  // Not "error": EventEmitter throws on an "error" nobody listens to, and an
  // engine can die between searches.
  failure: [Error];
};

export type ReviewProgressSink = {
  /**
   * Fires once when a phase of a move starts ("before" = position before the
   * move, "after" = position after it). `lines` holds the before-lines when
   * they are already known (reused from the previous move), else empty.
   */
  onPhaseProgress?: (input: {
    moveIndex: number;
    nodeId: string;
    san: string;
    ply: number;
    fenBefore: string;
    fenAfter: string;
    phase: ReviewProgressPhase;
    fen: string;
    mover: "white" | "black";
    depth: number;
    lines: AnalysisLine[];
  }) => void;
  /** Fires once per move, after the evaluation engine and every Maia level have reported. */
  onMoveCompleted?: (input: { moveIndex: number; move: MoveReview }) => void;
  shouldCancel?: () => boolean;
};

export type ReviewEngineOptions = {
  /** UCI Threads for the evaluation engine. */
  threads?: number;
  /** UCI Hash (MB) for the evaluation engine. */
  hashMb?: number;
  /** Player rating; picks the Maia bucket behind the `human_error` classification. */
  playerRating?: number | null;
};

/** Finished moves of earlier reviews (see ReviewCache). */
const reviewCache = new ReviewCache();

/** Everything a move's review depends on besides the move itself. */
function reviewJobKey(
  config: EngineConfig,
  maiaConfigs: readonly (EngineConfig & { maiaRating: MaiaRating })[],
  multipv: number,
  search: ResolvedReviewSearch,
  options: ReviewEngineOptions
): string {
  const engine = (item: EngineConfig) => [item.id, item.executablePath, item.args, item.weightsPath, item.updatedAt];
  return JSON.stringify([
    GAME_REVIEW_SCHEMA_VERSION,
    engine(config),
    maiaConfigs.map((item) => [...engine(item), item.maiaRating]),
    multipv,
    search,
    options.threads ?? null,
    options.hashMb ?? null,
    options.playerRating ?? null
  ]);
}

type MaiaSlot = {
  config: EngineConfig & { maiaRating: MaiaRating };
  session: UciReviewSession;
  alive: boolean;
};

export async function reviewGameWithEngine(
  config: EngineConfig,
  input: ReviewGameInput,
  sink: ReviewProgressSink = {},
  maiaConfigs: readonly (EngineConfig & { maiaRating: MaiaRating })[] = [],
  options: ReviewEngineOptions = {}
): Promise<GameReview> {
  const multipv = Math.max(1, Math.min(Math.round(input.multipv ?? 3), 5));
  const search = resolveReviewSearchParams(input);
  const timeControl = parseTimeControl(input.timeControl);
  const session = new UciReviewSession(config);
  let maiaSlots: MaiaSlot[] = maiaConfigs.map((cfg) => ({
    config: cfg,
    session: new UciReviewSession(cfg),
    alive: true
  }));

  try {
    // Maia (lc0) weight loads take seconds each: start everything in parallel.
    // A broken Maia degrades the review (that level is dropped); a broken
    // evaluation engine fails it.
    const [mainStart, ...maiaStarts] = await Promise.allSettled([
      session.start({ multipv, threads: options.threads, hashMb: options.hashMb }),
      ...maiaSlots.map((slot) => slot.session.start({ policyOnly: true }))
    ]);
    if (mainStart.status === "rejected") throw mainStart.reason;
    maiaSlots = maiaSlots.filter((slot, index) => {
      const result = maiaStarts[index];
      if (result.status === "fulfilled") return true;
      logger.warn("review", `Maia ${slot.config.maiaRating} failed to start; continuing without it:`, result.reason);
      slot.session.stop();
      return false;
    });
    const maiaEngines = maiaSlots.map((slot) => ({
      rating: slot.config.maiaRating,
      engineId: slot.config.id,
      name: slot.config.name
    }));

    const moves: MoveReview[] = [];
    let previousReplyLines: AnalysisLine[] | null = null;
    const cached = reviewCache.job(reviewJobKey(config, maiaSlots.map((slot) => slot.config), multipv, search, options));
    for (let index = 0; index < input.moves.length; index += 1) {
      if (sink.shouldCancel?.()) throw new Error("Review cancelled");
      const move = input.moves[index];
      const mover = statusForFen(move.fenBefore).turn;
      const playedUci = standardCastlingUci(move.fenBefore, move.uci);
      const cacheKey = moveKey(move.fenBefore, move.uci, input.moves[index - 1]?.uci ?? null);
      const done = cached.get(cacheKey);
      if (done) {
        // Already reviewed with this configuration: reuse it (only the game's own clock facts differ).
        const moveReview: MoveReview = { ...done.review, nodeId: move.nodeId, ply: move.ply };
        delete moveReview.clockRemainingMs;
        delete moveReview.timeSpentMs;
        const reusedClock = parseClock(move.clockAfter);
        if (reusedClock !== null) moveReview.clockRemainingMs = reusedClock;
        const reusedSpent = timeSpentForMove(input.moves, index, timeControl);
        if (reusedSpent !== undefined) moveReview.timeSpentMs = reusedSpent;
        previousReplyLines = terminalStateForFen(move.fenAfter) ? null : done.replyLines;
        moves.push(moveReview);
        sink.onMoveCompleted?.({ moveIndex: index, move: moveReview });
        continue;
      }
      const emitPhase = (phase: ReviewProgressPhase, lines: AnalysisLine[]) =>
        sink.onPhaseProgress?.({
          moveIndex: index,
          nodeId: move.nodeId,
          san: move.san,
          ply: move.ply,
          fenBefore: move.fenBefore,
          fenAfter: move.fenAfter,
          phase,
          fen: phase === "before" ? move.fenBefore : move.fenAfter,
          mover,
          depth: lines[0]?.depth ?? 0,
          lines
        });

      // The previous move's reply lines are this move's top lines (same
      // position, same search settings): one full search per ply.
      emitPhase("before", previousReplyLines ?? []);
      const topLinesPromise: Promise<AnalysisLine[]> = previousReplyLines
        ? Promise.resolve(previousReplyLines)
        : session.analyze({ fen: move.fenBefore, multipv, search, shouldCancel: sink.shouldCancel });
      const activeMaia = maiaSlots.filter((slot) => slot.alive);
      const maiaPromise = Promise.allSettled(
        activeMaia.map(async (slot) => ({ slot, policy: await slot.session.analyzePolicy(move.fenBefore, sink.shouldCancel) }))
      );

      const topLines = await topLinesPromise;
      if (sink.shouldCancel?.()) throw new Error("Review cancelled");

      const terminal = terminalStateForFen(move.fenAfter);
      let replyLines: AnalysisLine[] = [];
      if (!terminal) {
        emitPhase("after", []);
        replyLines = await session.analyze({ fen: move.fenAfter, multipv, search, shouldCancel: sink.shouldCancel });
      }
      previousReplyLines = terminal ? null : replyLines;

      const bestMove = topLines[0]?.pv[0] ?? null;
      const humanPredictions: RatingPrediction[] = [];
      for (const [slotIndex, result] of (await maiaPromise).entries()) {
        if (result.status === "rejected") {
          const slot = activeMaia[slotIndex];
          if (slot) {
            // Stop retrying a Maia that errored or timed out; the rest carry on.
            logger.warn("review", `Maia ${slot.config.maiaRating} failed; dropping it:`, result.reason);
            slot.alive = false;
            slot.session.stop();
          }
          continue;
        }
        const { slot, policy } = result.value;
        const prediction = buildRatingPrediction({
          rating: slot.config.maiaRating,
          engineId: slot.config.id,
          fen: move.fenBefore,
          stats: policy.stats,
          wdl: policy.wdl,
          playedUci,
          bestUci: bestMove
        });
        if (prediction) humanPredictions.push(prediction);
      }
      if (sink.shouldCancel?.()) throw new Error("Review cancelled");

      const moveReview = buildMoveReview({
        move,
        playedUci,
        topLines,
        replyLines,
        terminal,
        humanPredictions,
        playerRating: options.playerRating ?? null,
        previousMove: input.moves[index - 1]?.uci ?? null
      });
      const currentClock = parseClock(move.clockAfter);
      if (currentClock !== null) moveReview.clockRemainingMs = currentClock;
      const spent = timeSpentForMove(input.moves, index, timeControl);
      if (spent !== undefined) moveReview.timeSpentMs = spent;
      moves.push(moveReview);
      ReviewCache.put(cached, cacheKey, { review: moveReview, replyLines }, reviewCache.maxMoves);
      sink.onMoveCompleted?.({ moveIndex: index, move: moveReview });
    }

    return {
      schemaVersion: GAME_REVIEW_SCHEMA_VERSION,
      engineId: config.id,
      engineName: session.engineName ?? config.name,
      engineSettings: {
        multipv,
        moveTimeMs: search.recordMoveTimeMs,
        depth: search.recordDepth,
        ...(session.appliedThreads !== null ? { threads: session.appliedThreads } : {}),
        ...(session.appliedHashMb !== null ? { hashMb: session.appliedHashMb } : {})
      },
      maiaEngines,
      predictionEngineIds: maiaEngines.map((engine) => engine.engineId),
      depth: search.recordDepth,
      moveTimeMs: search.recordMoveTimeMs,
      multipv,
      createdAt: Date.now(),
      summary: summarize(moves),
      moves
    };
  } finally {
    session.stop();
    for (const slot of maiaSlots) slot.session.stop();
  }
}

function buildMoveReview(input: {
  move: ReviewMoveInputItem;
  playedUci: string;
  topLines: AnalysisLine[];
  replyLines: AnalysisLine[];
  terminal: TerminalState | null;
  humanPredictions: RatingPrediction[];
  playerRating: number | null;
  previousMove: string | null;
}): MoveReview {
  const { move, playedUci, topLines, replyLines, terminal, humanPredictions } = input;
  const best = topLines[0] ?? null;
  const moverAfter = statusForFen(move.fenAfter).turn;
  // Side-to-move score of fenAfter (opponent's perspective), synthesized when the game ended.
  const afterScore = terminal ? terminalScore(terminal) : replyLines[0]?.score ?? null;
  // White-perspective, except a checkmate stays `mate 0` (= side to move is mated; see `terminal`).
  const evalAfter = terminal === "checkmate"
    ? { type: "mate" as const, value: 0 }
    : afterScore
      ? scoreFromWhitePerspective(afterScore, moverAfter)
      : null;
  const playedLine = topLines.find((line) => line.pv[0] === playedUci) ?? null;
  const playedRank = playedLine?.multipv ?? null;
  const evalLoss = computeEvalLoss({ topLines, playedRank, afterScore, terminal });
  const bestMove = best?.pv[0] ?? null;

  // `human_error`: the top move of the Maia bucket nearest the player's rating.
  const bucket = nearestRatingBucket(input.playerRating, humanPredictions.map((p) => p.rating));
  const humanPrediction = humanPredictions.find((p) => p.rating === bucket)?.topMoves[0]?.uci ?? null;
  const motifs = tacticalMotifsForBestMove(move.fenBefore, bestMove, best?.score ?? null, input.previousMove);
  const hasMissedTactic = Boolean(bestMove && bestMove !== playedUci) && motifs.length > 0 && (evalLoss ?? 0) >= 150;
  const classification = terminal === "checkmate"
    ? "best"
    : classifyMove({ playedMove: playedUci, bestMove, evalLoss, hasMissedTactic, humanPrediction });

  return {
    nodeId: move.nodeId,
    ply: move.ply,
    san: move.san,
    playedMove: playedUci,
    fenBefore: move.fenBefore,
    fenAfter: move.fenAfter,
    evalBefore: best?.scoreWhite ?? null,
    evalAfter,
    // Eval after the engine's choice = its best line from the same search.
    bestEvalAfter: best?.scoreWhite ?? null,
    evalLoss,
    classification,
    bestMove,
    bestLine: best?.pv ?? [],
    topLines,
    replyLines,
    playedRank,
    playedLineScore: playedLine?.score ?? null,
    wdlBefore: best?.wdl ?? null,
    wdlAfter: terminal ? terminalWdl(terminal) : replyLines[0]?.wdl ?? null,
    terminal,
    humanPredictions: humanPredictions.length > 0 ? humanPredictions : undefined,
    motifs
  };
}

type PolicyResult = { stats: Lc0MoveStat[]; wdl?: Wdl };

class UciReviewSession {
  private process: ChildProcessWithoutNullStreams | null = null;
  private events = new EventEmitter<LineEvents>();
  private supportedOptions = new Set<string>();
  /** Rolling tails for timeout diagnostics. */
  private recentLines: string[] = [];
  private recentStderr: string[] = [];
  private recentCommands: string[] = [];
  private currentMultipv = 1;
  /** Set once the process died; later waits reject immediately instead of timing out. */
  private failure: Error | null = null;
  engineName: string | null = null;
  appliedThreads: number | null = null;
  appliedHashMb: number | null = null;

  constructor(private config: EngineConfig) { }

  async start(options: { multipv?: number; threads?: number; hashMb?: number; policyOnly?: boolean }): Promise<void> {
    const tag = `uci:${this.config.name}`;
    if (LOG_UCI) logger.info(tag, "spawn", this.config.executablePath, this.config.args);
    this.process = spawnUciProcess(this.config);

    this.process.stdout.on("data", createLineSplitter((line) => this.handleLine(line)));
    // Lc0 prints banners / progress to stderr; not a failure. Captured for diagnostics.
    this.process.stderr.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        if (LOG_UCI) logger.info(tag, "[stderr]", line);
        pushTail(this.recentStderr, line);
      }
    });
    this.process.on("error", (error) => this.fail(error));
    this.process.on("exit", (code) => {
      if (this.process) this.fail(new Error(`${this.config.name} exited unexpectedly (code ${code ?? "unknown"})`));
    });

    const uciReady = this.waitFor(
      (line) => {
        const option = line.match(/^option name (.+?) type /);
        if (option) this.supportedOptions.add(option[1]);
        const name = line.match(/^id name (.+)$/);
        if (name) this.engineName = name[1].trim();
        return line === "uciok";
      },
      120_000,
      "Timed out waiting for uciok (large NN weights can take a while; check --weights for lc0)"
    );
    this.write("uci");
    await uciReady;

    if (options.policyOnly) {
      // Maia: `go nodes 1` + VerboseMoveStats prints the raw policy prior of
      // every legal move and the root value head. PolicyTemperature 1 gives the
      // network's true distribution (lc0 defaults to 1.359, which flattens it).
      this.setOption("VerboseMoveStats", "true");
      this.setOption("PolicyTemperature", "1.0");
      this.setOption("MinibatchSize", "1");
      this.setOption("MaxPrefetch", "0");
      this.setOption("UCI_ShowWDL", "true");
      this.setOption("MultiPV", "1");
    } else {
      if (options.threads && this.setOption("Threads", String(options.threads))) this.appliedThreads = options.threads;
      if (options.hashMb && this.setOption("Hash", String(options.hashMb))) this.appliedHashMb = options.hashMb;
      this.setOption("UCI_ShowWDL", "true");
      this.currentMultipv = options.multipv ?? 1;
      this.setOption("MultiPV", String(this.currentMultipv));
    }
    await this.ready();
    this.write("ucinewgame");
  }

  /** MultiPV search of `fen`; resolves with the final lines when the engine prints bestmove. */
  async analyze(input: {
    fen: string;
    multipv: number;
    search: ResolvedReviewSearch;
    shouldCancel?: () => boolean;
  }): Promise<AnalysisLine[]> {
    if (input.multipv !== this.currentMultipv) {
      this.currentMultipv = input.multipv;
      this.setOption("MultiPV", String(input.multipv));
    }
    const go = input.search.nodes !== null && input.search.nodes > 0
      ? `go nodes ${input.search.nodes}`
      : input.search.moveTimeMs
        ? `go movetime ${input.search.moveTimeMs}`
        : `go depth ${input.search.depth}`;
    const infos: EngineInfo[] = [];
    await this.search({
      fen: input.fen,
      go,
      timeoutMs: reviewAnalysisTimeoutMs({
        moveTimeMs: input.search.moveTimeMs,
        depth: input.search.depth,
        multipv: input.multipv,
        nodes: input.search.nodes
      }),
      shouldCancel: input.shouldCancel,
      onLine: (line) => {
        const info = parseInfoLine(this.config.id, line);
        if (info?.score && info.pv?.length) infos.push(info);
      }
    });
    return linesFromInfoStream(input.fen, infos);
  }

  /** Maia policy for `fen` (requires `start({ policyOnly: true })`). */
  async analyzePolicy(fen: string, shouldCancel?: () => boolean): Promise<PolicyResult> {
    const stats: Lc0MoveStat[] = [];
    let wdl: Wdl | undefined;
    await this.search({
      fen,
      go: "go nodes 1",
      timeoutMs: reviewAnalysisTimeoutMs({ moveTimeMs: null, depth: 1, multipv: 1, nodes: 1 }),
      shouldCancel,
      onLine: (line) => {
        const stat = parseLc0MoveStat(line);
        if (stat) {
          stats.push(stat);
          return;
        }
        const info = parseInfoLine(this.config.id, line);
        if (info?.wdl && (info.multipv ?? 1) === 1) wdl = info.wdl;
      }
    });
    return { stats, wdl };
  }

  stop(): void {
    const proc = this.process;
    this.process = null;
    stopUciProcess(proc);
  }

  private fail(error: Error): void {
    this.failure ??= error;
    this.events.emit("failure", error);
  }

  /** Sends `setoption` only for options the engine advertised. Returns whether it was sent. */
  private setOption(name: string, value: string): boolean {
    if (!this.supportedOptions.has(name)) return false;
    this.write(`setoption name ${name} value ${value}`);
    return true;
  }

  private async ready(): Promise<void> {
    const engineReady = this.waitFor((line) => line === "readyok", 25_000, "Timed out waiting for readyok");
    this.write("isready");
    await engineReady;
  }

  private async search(input: {
    fen: string;
    go: string;
    timeoutMs: number;
    shouldCancel?: () => boolean;
    onLine: (line: string) => void;
  }): Promise<void> {
    await this.ready();
    this.write(`position fen ${input.fen}`);
    let received = 0;
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        clearInterval(cancelInterval);
        this.events.off("line", onLine);
        this.events.off("failure", onError);
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onLine = (line: string) => {
        if (line.startsWith("bestmove")) {
          cleanup();
          resolve();
          return;
        }
        received += 1;
        input.onLine(line);
      };
      const timeout = setTimeout(() => {
        cleanup();
        const snapshot = this.debugSnapshot();
        const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
        const diagnostics = [
          ``,
          `╔══ ENGINE TIMEOUT ══════════════════════════════════════════════════════`,
          `║ engine:     ${this.config.name}`,
          `║ executable: ${this.config.executablePath}`,
          `║ weights:    ${this.config.weightsPath ?? "(none)"}`,
          `║ command:    ${input.go}`,
          `║ fen:        ${input.fen}`,
          `║ elapsed:    ${elapsedSeconds}s of ${Math.round(input.timeoutMs / 1000)}s budget`,
          `║ lines:      ${received} received before timeout`,
          `╠── last 10 commands sent ───────────────────────────────────────────────`,
          ...snapshot.commands.slice(-10).map((c) => `║   → ${c}`),
          `╠── last 10 stdout lines ────────────────────────────────────────────────`,
          ...snapshot.lines.slice(-10).map((l) => `║   ← ${l}`),
          `╠── last 10 stderr lines ────────────────────────────────────────────────`,
          ...(snapshot.stderr.length > 0 ? snapshot.stderr.slice(-10).map((l) => `║   ⚠ ${l}`) : [`║   (none)`]),
          `╚════════════════════════════════════════════════════════════════════════`
        ].join("\n");
        logger.error("review", `engine timeout${diagnostics}`);
        reject(new Error(`${this.config.name} did not answer "${input.go}" within ${elapsedSeconds}s.`));
      }, input.timeoutMs);
      let stopSent = false;
      const cancelInterval = setInterval(() => {
        if (stopSent) return;
        if (input.shouldCancel?.()) {
          stopSent = true;
          this.write("stop");
        }
      }, 100);

      this.events.on("line", onLine);
      this.events.on("failure", onError);
      this.write(input.go);
    });
  }

  private write(command: string): void {
    if (LOG_UCI) logger.info(`uci:${this.config.name}`, "→", command);
    pushTail(this.recentCommands, command);
    writeUci(this.process, command);
  }

  private debugSnapshot(): { commands: string[]; lines: string[]; stderr: string[] } {
    return {
      commands: [...this.recentCommands],
      lines: [...this.recentLines],
      stderr: [...this.recentStderr]
    };
  }

  private waitFor(
    predicate: (line: string) => boolean,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<string> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        this.events.off("line", onLine);
        this.events.off("failure", onError);
      };
      const onLine = (line: string) => {
        if (!predicate(line)) return;
        cleanup();
        resolve(line);
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(timeoutMessage));
      }, timeoutMs);
      this.events.on("line", onLine);
      this.events.on("failure", onError);
    });
  }

  private handleLine(line: string): void {
    if (LOG_UCI) logger.info(`uci:${this.config.name}`, "←", line);
    pushTail(this.recentLines, line);
    this.events.emit("line", line);
  }
}

function pushTail(buffer: string[], line: string): void {
  buffer.push(line);
  if (buffer.length > 50) buffer.shift();
}

const SUMMARY_FIELD: Record<MoveClassification, Exclude<keyof GameReviewSummary, "totalMoves" | "averageCentipawnLoss">> = {
  best: "best",
  excellent: "excellent",
  good: "good",
  inaccuracy: "inaccuracies",
  mistake: "mistakes",
  blunder: "blunders",
  missed_tactic: "missedTactics",
  human_error: "humanErrors"
};

function summarize(moves: MoveReview[]): GameReviewSummary {
  const counts = { best: 0, excellent: 0, good: 0, inaccuracies: 0, mistakes: 0, blunders: 0, missedTactics: 0, humanErrors: 0 };
  let evalLossSum = 0;
  let evalLossCount = 0;
  for (const move of moves) {
    counts[SUMMARY_FIELD[move.classification]] += 1;
    if (move.evalLoss !== null) {
      evalLossSum += move.evalLoss;
      evalLossCount += 1;
    }
  }
  return {
    totalMoves: moves.length,
    ...counts,
    averageCentipawnLoss: evalLossCount ? Math.round(evalLossSum / evalLossCount) : null
  };
}
