import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  GAME_REVIEW_SCHEMA_VERSION,
  type AnalysisLine,
  type EngineConfig,
  type EngineInfo,
  type GameReview,
  type MaiaRating,
  type MoveAssessment,
  type MoveReview,
  type MoveVerification,
  type RatingPrediction,
  type ReviewGameInput,
  type ReviewMoveInputItem,
  type ReviewProgressPhase,
  type TerminalState,
  type Wdl
} from "@chaturanga/shared/types/engine";
import { statusForFen } from "@chaturanga/shared/chess/position";
import {
  scoreFromWhitePerspective,
  standardCastlingUci,
  terminalStateForFen
} from "@chaturanga/shared/chess/review";
import {
  MOVE_ASSESSMENT_POLICY,
  assessMove,
  summarizeMoves,
  verificationNeed,
  type VerificationNeed
} from "@chaturanga/shared/chess/move-assessment";
import { parseInfoLine, parseLc0MoveStat, type Lc0MoveStat } from "@chaturanga/shared/engine/uci";
import { logger } from "../logger";
import {
  deeperReviewSearch,
  resolveReviewSearchParams,
  reviewAnalysisTimeoutMs,
  type ResolvedReviewSearch
} from "./review-search";
import {
  buildRatingPrediction,
  computeEvalLoss,
  linesFromInfoStream,
  parseClock,
  parseTimeControl,
  tacticalMotifsForBestMove,
  terminalScore,
  terminalWdl,
  timeSpentForMove
} from "./review-analysis";
import {
  createLineSplitter,
  LOG_UCI,
  spawnUciProcess,
  stopUciProcess,
  writeUci
} from "./uci-process";
import { fileStamp, moveKey, ReviewCache, type CachedMove } from "./review-cache";
import {
  createUciIdentity,
  readHandshakeLine,
  UCIOK_TIMEOUT_MESSAGE,
  UCIOK_TIMEOUT_MS
} from "./uci-handshake";

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
  /** Player rating; picks the Maia level whose difficulty the move assessment reads. */
  playerRating?: number | null;
  /**
   * How long an optional check search (see verifyMove) may take before the move is left unverified
   * and the review goes on. Defaults to the search's own timeout.
   */
  checkTimeoutMs?: number;
};

/** Finished moves of earlier reviews (see ReviewCache). */
const reviewCache = new ReviewCache();

/**
 * Everything a move's review depends on besides the move itself. `stamps` are the engines' file
 * stamps as they were loaded (see engineFileStamps), not read again here.
 */
function reviewJobKey(
  config: EngineConfig,
  maiaConfigs: readonly (EngineConfig & { maiaRating: MaiaRating })[],
  stamps: ReadonlyMap<EngineConfig, readonly (string | null)[]>,
  multipv: number,
  search: ResolvedReviewSearch,
  options: ReviewEngineOptions
): string {
  const engine = (item: EngineConfig) => [
    item.id,
    item.executablePath,
    item.args,
    item.weightsPath,
    stamps.get(item) ?? null,
    item.updatedAt
  ];
  return JSON.stringify([
    GAME_REVIEW_SCHEMA_VERSION,
    MOVE_ASSESSMENT_POLICY,
    engine(config),
    maiaConfigs.map((item) => [...engine(item), item.maiaRating]),
    multipv,
    search,
    options.threads ?? null,
    options.hashMb ?? null,
    options.playerRating ?? null
  ]);
}

/** The binary and weights stamps of every engine of a review (see fileStamp). */
function engineFileStamps(configs: readonly EngineConfig[]): Map<EngineConfig, (string | null)[]> {
  return new Map(
    configs.map((item) => [item, [fileStamp(item.executablePath), fileStamp(item.weightsPath)]])
  );
}

function sameStamps(
  a: ReadonlyMap<EngineConfig, readonly (string | null)[]>,
  b: typeof a
): boolean {
  return [...a].every(([item, stamps]) => JSON.stringify(stamps) === JSON.stringify(b.get(item)));
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
  const session = new UciReviewSession(config, sink.shouldCancel);
  let maiaSlots: MaiaSlot[] = maiaConfigs.map((cfg) => ({
    config: cfg,
    session: new UciReviewSession(cfg, sink.shouldCancel),
    alive: true
  }));

  // Taken before the engines start: a file replaced while they load may not be what they loaded.
  const stampsBeforeStart = engineFileStamps([config, ...maiaConfigs]);
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
      logger.warn(
        "review",
        `Maia ${slot.config.maiaRating} failed to start; continuing without it:`,
        result.reason
      );
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
    // Each move is assessed in the context of the one before it (the opponent's move into it).
    let previousAssessed: { move: MoveReview; assessment: MoveAssessment } | null = null;
    const assess = (review: MoveReview): MoveReview => {
      const assessment = assessMove(review, {
        previous: previousAssessed,
        playerRating: options.playerRating ?? null
      });
      const assessed: MoveReview = { ...review, assessment };
      previousAssessed = { move: assessed, assessment };
      return assessed;
    };
    // An engine file replaced during startup: this review's results are not cached under either
    // version. Otherwise they are keyed by the stamps taken before the start (what was loaded).
    const cached = sameStamps(stampsBeforeStart, engineFileStamps([config, ...maiaConfigs]))
      ? reviewCache.job(
          reviewJobKey(
            config,
            maiaSlots.map((slot) => slot.config),
            stampsBeforeStart,
            multipv,
            search,
            options
          )
        )
      : new Map<string, CachedMove>();
    for (let index = 0; index < input.moves.length; index += 1) {
      if (sink.shouldCancel?.()) throw new Error("Review cancelled");
      const move = input.moves[index];
      const mover = statusForFen(move.fenBefore).turn;
      const playedUci = standardCastlingUci(move.fenBefore, move.uci);
      const cacheKey = moveKey(move.fenBefore, move.uci, input.moves[index - 1]?.uci ?? null);
      const done = cached.get(cacheKey);
      if (done) {
        // Most recently used goes last (eviction takes the oldest).
        ReviewCache.put(cached, cacheKey, done, reviewCache.maxMoves);
        // Already reviewed with this configuration: reuse it (only this game's notation and clock
        // facts differ).
        const moveReview: MoveReview = {
          ...done.review,
          nodeId: move.nodeId,
          ply: move.ply,
          san: move.san
        };
        delete moveReview.clockRemainingMs;
        delete moveReview.timeSpentMs;
        const reusedClock = parseClock(move.clockAfter);
        if (reusedClock !== null) moveReview.clockRemainingMs = reusedClock;
        const reusedSpent = timeSpentForMove(input.moves, index, timeControl);
        if (reusedSpent !== undefined) moveReview.timeSpentMs = reusedSpent;
        previousReplyLines = terminalStateForFen(move.fenAfter) ? null : done.replyLines;
        const assessed = assess(moveReview);
        moves.push(assessed);
        sink.onMoveCompleted?.({ moveIndex: index, move: assessed });
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
        : session.analyze({
            fen: move.fenBefore,
            multipv,
            search,
            shouldCancel: sink.shouldCancel
          });
      const activeMaia = maiaSlots.filter((slot) => slot.alive);
      const maiaPromise = Promise.allSettled(
        activeMaia.map(async (slot) => ({
          slot,
          policy: await slot.session.analyzePolicy(move.fenBefore, sink.shouldCancel)
        }))
      );

      const topLines = await topLinesPromise;
      if (sink.shouldCancel?.()) throw new Error("Review cancelled");

      const terminal = terminalStateForFen(move.fenAfter);
      let replyLines: AnalysisLine[] = [];
      if (!terminal) {
        emitPhase("after", []);
        replyLines = await session.analyze({
          fen: move.fenAfter,
          multipv,
          search,
          shouldCancel: sink.shouldCancel
        });
      }
      previousReplyLines = terminal ? null : replyLines;

      const bestMove = topLines[0]?.pv[0] ?? null;
      const humanPredictions: RatingPrediction[] = [];
      for (const [slotIndex, result] of (await maiaPromise).entries()) {
        if (result.status === "rejected") {
          const slot = activeMaia[slotIndex];
          if (slot) {
            // Stop retrying a Maia that errored or timed out; the rest carry on.
            logger.warn(
              "review",
              `Maia ${slot.config.maiaRating} failed; dropping it:`,
              result.reason
            );
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
        previousMove: input.moves[index - 1]?.uci ?? null
      });
      const currentClock = parseClock(move.clockAfter);
      if (currentClock !== null) moveReview.clockRemainingMs = currentClock;
      const spent = timeSpentForMove(input.moves, index, timeControl);
      if (spent !== undefined) moveReview.timeSpentMs = spent;
      // A Great / Brilliant candidate gets a deeper search before it can be marked; an error near
      // a severity boundary, judged from a separate search, is searched again on the same budget.
      // The check is optional: when it fails (a timeout, an engine error) the move is assessed
      // without it, so it stays unverified, and the review goes on. Cancelling still stops it.
      const need = verificationNeed(moveReview, {
        previous: previousAssessed,
        playerRating: options.playerRating ?? null
      });
      let checkFailed = false;
      if (need) {
        try {
          moveReview.verification = await verifyMove(session, moveReview, need, {
            multipv,
            search,
            shouldCancel: sink.shouldCancel,
            timeoutMs: options.checkTimeoutMs
          });
        } catch (error) {
          if (sink.shouldCancel?.()) throw new Error("Review cancelled", { cause: error });
          checkFailed = true;
          logger.warn(
            "review",
            `Checking ${move.san} failed; it is assessed without the check:`,
            error
          );
        }
        if (sink.shouldCancel?.()) throw new Error("Review cancelled");
      }
      // Only complete results are kept: after a Maia level failed, this review's moves lack its
      // prediction, and a later review (with Maia working again) must search them afresh; a move
      // whose check failed is checked again next time. Kept unassessed: the assessment depends on
      // the move before, which another game may differ in.
      if (!checkFailed && maiaSlots.every((slot) => slot.alive)) {
        ReviewCache.put(cached, cacheKey, { review: moveReview, replyLines }, reviewCache.maxMoves);
      }
      const assessed = assess(moveReview);
      moves.push(assessed);
      sink.onMoveCompleted?.({ moveIndex: index, move: assessed });
    }

    return {
      schemaVersion: GAME_REVIEW_SCHEMA_VERSION,
      assessmentPolicy: MOVE_ASSESSMENT_POLICY,
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
      summary: summarizeMoves(moves),
      moves
    };
  } finally {
    session.stop();
    for (const slot of maiaSlots) slot.session.stop();
  }
}

/**
 * MultiPV searches of a few single positions in one engine process, in turn, with the review's
 * search bound (`moveTimeMs`) and Threads / Hash. A finished position (mate, stalemate) gets no
 * lines. Not cached: the puzzle explanation asks once per puzzle.
 */
export async function analysePositionsWithEngine(
  config: EngineConfig,
  input: { positions: readonly { fen: string; multipv: number }[]; moveTimeMs: number },
  options: Pick<ReviewEngineOptions, "threads" | "hashMb"> & { shouldCancel?: () => boolean } = {}
): Promise<{ engineName: string; lines: AnalysisLine[][] }> {
  const search = resolveReviewSearchParams({ moveTimeMs: input.moveTimeMs });
  const clamp = (multipv: number) => Math.max(1, Math.min(Math.round(multipv), 5));
  const session = new UciReviewSession(config, options.shouldCancel);
  try {
    await session.start({
      multipv: clamp(input.positions[0]?.multipv ?? 1),
      threads: options.threads,
      hashMb: options.hashMb
    });
    const lines: AnalysisLine[][] = [];
    for (const position of input.positions) {
      if (options.shouldCancel?.()) throw new Error("Review cancelled");
      lines.push(
        terminalStateForFen(position.fen)
          ? []
          : await session.analyze({
              fen: position.fen,
              multipv: clamp(position.multipv),
              search,
              shouldCancel: options.shouldCancel
            })
      );
    }
    // A search stopped by the cancel ends with bestmove too: its partial lines are not an answer.
    if (options.shouldCancel?.()) throw new Error("Review cancelled");
    return { engineName: session.engineName ?? config.name, lines };
  } finally {
    session.stop();
  }
}

function buildMoveReview(input: {
  move: ReviewMoveInputItem;
  playedUci: string;
  topLines: AnalysisLine[];
  replyLines: AnalysisLine[];
  terminal: TerminalState | null;
  humanPredictions: RatingPrediction[];
  previousMove: string | null;
}): MoveReview {
  const { move, playedUci, topLines, replyLines, terminal, humanPredictions } = input;
  const best = topLines[0] ?? null;
  const moverAfter = statusForFen(move.fenAfter).turn;
  // Side-to-move score of fenAfter (opponent's perspective), synthesized when the game ended.
  const afterScore = terminal ? terminalScore(terminal) : (replyLines[0]?.score ?? null);
  // White-perspective, except a checkmate stays `mate 0` (= side to move is mated; see `terminal`).
  const evalAfter =
    terminal === "checkmate"
      ? { type: "mate" as const, value: 0 }
      : afterScore
        ? scoreFromWhitePerspective(afterScore, moverAfter)
        : null;
  const playedLine = topLines.find((line) => line.pv[0] === playedUci) ?? null;
  const playedRank = playedLine?.multipv ?? null;
  const evalLoss = computeEvalLoss({ topLines, playedRank, afterScore, terminal });
  const bestMove = best?.pv[0] ?? null;

  const motifs = tacticalMotifsForBestMove(
    move.fenBefore,
    bestMove,
    best?.score ?? null,
    input.previousMove
  );

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
    bestMove,
    bestLine: best?.pv ?? [],
    topLines,
    replyLines,
    playedRank,
    playedLineScore: playedLine?.score ?? null,
    wdlBefore: best?.wdl ?? null,
    wdlAfter: terminal ? terminalWdl(terminal) : (replyLines[0]?.wdl ?? null),
    terminal,
    humanPredictions: humanPredictions.length > 0 ? humanPredictions : undefined,
    motifs
  };
}

/**
 * The extra search a move needs before it is assessed (see verificationNeed): a deeper MultiPV
 * search of the position for a Great / Brilliant candidate, or a search of only the played move
 * on the review's own budget for an error near a severity boundary.
 */
async function verifyMove(
  session: UciReviewSession,
  move: MoveReview,
  need: VerificationNeed,
  input: {
    multipv: number;
    search: ResolvedReviewSearch;
    shouldCancel?: () => boolean;
    timeoutMs?: number;
  }
): Promise<MoveVerification> {
  switch (need) {
    case "candidate":
      return {
        deeperLines: await session.analyze({
          fen: move.fenBefore,
          multipv: Math.max(2, input.multipv),
          search: deeperReviewSearch(input.search),
          shouldCancel: input.shouldCancel,
          timeoutMs: input.timeoutMs
        })
      };
    case "recheck": {
      const lines = await session.analyze({
        fen: move.fenBefore,
        multipv: 1,
        search: input.search,
        searchMoves: [move.playedMove],
        shouldCancel: input.shouldCancel,
        timeoutMs: input.timeoutMs
      });
      return { playedLine: lines.find((line) => line.pv[0] === move.playedMove) ?? null };
    }
  }
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

  /** `shouldCancel` is polled while waiting for the engine (startup included), not only mid-search. */
  constructor(
    private config: EngineConfig,
    private shouldCancel?: () => boolean
  ) {}

  async start(options: {
    multipv?: number;
    threads?: number;
    hashMb?: number;
    policyOnly?: boolean;
  }): Promise<void> {
    const tag = `uci:${this.config.name}`;
    if (LOG_UCI) logger.info(tag, "spawn", this.config.executablePath, this.config.args);
    this.process = spawnUciProcess(this.config);

    this.process.stdout.on(
      "data",
      createLineSplitter((line) => this.handleLine(line))
    );
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
      if (this.process)
        this.fail(new Error(`${this.config.name} exited unexpectedly (code ${code ?? "unknown"})`));
    });

    const identity = createUciIdentity();
    identity.options = this.supportedOptions;
    const uciReady = this.waitFor(
      (line) => readHandshakeLine(identity, line),
      UCIOK_TIMEOUT_MS,
      UCIOK_TIMEOUT_MESSAGE
    );
    this.write("uci");
    await uciReady;
    this.engineName = identity.name ?? null;

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
      if (options.threads && this.setOption("Threads", String(options.threads)))
        this.appliedThreads = options.threads;
      if (options.hashMb && this.setOption("Hash", String(options.hashMb)))
        this.appliedHashMb = options.hashMb;
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
    /** Restricts the search to these moves (UCI `searchmoves`, sent last). */
    searchMoves?: readonly string[];
    shouldCancel?: () => boolean;
    /** Overrides the budget's own timeout. */
    timeoutMs?: number;
  }): Promise<AnalysisLine[]> {
    if (input.multipv !== this.currentMultipv) {
      this.currentMultipv = input.multipv;
      this.setOption("MultiPV", String(input.multipv));
    }
    const bound =
      input.search.nodes !== null && input.search.nodes > 0
        ? `go nodes ${input.search.nodes}`
        : input.search.moveTimeMs
          ? `go movetime ${input.search.moveTimeMs}`
          : `go depth ${input.search.depth}`;
    const go = input.searchMoves?.length
      ? `${bound} searchmoves ${input.searchMoves.join(" ")}`
      : bound;
    const infos: EngineInfo[] = [];
    await this.search({
      fen: input.fen,
      go,
      timeoutMs:
        input.timeoutMs ??
        reviewAnalysisTimeoutMs({
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
    const engineReady = this.waitFor(
      (line) => line === "readyok",
      25_000,
      "Timed out waiting for readyok"
    );
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
          ...(snapshot.stderr.length > 0
            ? snapshot.stderr.slice(-10).map((l) => `║   ⚠ ${l}`)
            : [`║   (none)`]),
          `╚════════════════════════════════════════════════════════════════════════`
        ].join("\n");
        logger.error("review", `engine timeout${diagnostics}`);
        const error = new Error(
          `${this.config.name} did not answer "${input.go}" within ${elapsedSeconds}s.`
        );
        // Stop the search and take its bestmove, so the next search doesn't read it as its own. An
        // engine that won't stop is broken: every later wait fails at once.
        this.write("stop");
        this.waitFor(
          (line) => line.startsWith("bestmove"),
          STOP_DRAIN_MS,
          "No bestmove after stop"
        ).then(
          () => reject(error),
          () => {
            this.fail(error);
            reject(error);
          }
        );
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
    if (this.shouldCancel?.()) return Promise.reject(new Error("Review cancelled"));
    return new Promise((resolve, reject) => {
      const cancelPoll = this.shouldCancel
        ? setInterval(() => {
            if (!this.shouldCancel?.()) return;
            cleanup();
            reject(new Error("Review cancelled"));
          }, CANCEL_POLL_MS)
        : null;
      const cleanup = () => {
        if (cancelPoll) clearInterval(cancelPoll);
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

/** How long a timed-out search may take to stop before the engine counts as broken. */
const STOP_DRAIN_MS = 5_000;

/** How often a wait for the engine checks whether the review was cancelled. */
const CANCEL_POLL_MS = 100;

function pushTail(buffer: string[], line: string): void {
  buffer.push(line);
  if (buffer.length > 50) buffer.shift();
}
