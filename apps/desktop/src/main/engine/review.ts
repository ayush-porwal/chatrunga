import {
  GAME_REVIEW_SCHEMA_VERSION,
  type AnalysisLine,
  type EngineConfig,
  type EngineScore,
  type GameOpening,
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
import { classifyOpening } from "@chaturanga/shared/chess/opening-book";
import { engineDisplayName } from "@chaturanga/shared/engine/managed";
import { logger } from "../logger";
import { openingBook } from "./opening-book";
import {
  deeperReviewSearch,
  resolveReviewSearchParams,
  type ResolvedReviewSearch
} from "./review-search";
import {
  buildRatingPrediction,
  computeEvalLoss,
  tacticalMotifsForBestMove,
  terminalScore,
  terminalWdl
} from "./review-analysis";
import {
  parseClock,
  parseTimeControl,
  timeSpentForMove
} from "@chaturanga/shared/chess/move-times";
import { fileStamp, moveKey, ReviewCache, type CachedMove } from "./review-cache";
import { UciReviewSession, type PolicyResult } from "./uci-review-session";

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
  /**
   * Fires once per move, after the evaluation engine and every Maia level have reported. `opening`
   * is the game's (known before the first move: it comes from the opening book).
   */
  onMoveCompleted?: (input: {
    moveIndex: number;
    move: MoveReview;
    opening: GameOpening | null;
  }) => void;
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

type MaiaConfig = EngineConfig & { maiaRating: MaiaRating };

/** Everything a move's review depends on besides the move itself (see reviewJobKey). */
type ReviewJob = {
  config: EngineConfig;
  maiaConfigs: readonly MaiaConfig[];
  multipv: number;
  search: ResolvedReviewSearch;
  options: ReviewEngineOptions;
};

/**
 * The cache key of a review job. `stamps` are the engines' file stamps as they were loaded (see
 * engineFileStamps), not read again here.
 */
function reviewJobKey(
  { config, maiaConfigs, multipv, search, options }: ReviewJob,
  stamps: ReadonlyMap<EngineConfig, readonly (string | null)[]>
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
  config: MaiaConfig;
  session: UciReviewSession;
  alive: boolean;
};

/** A review in progress: its engines and settings, and the game's facts every move reads. */
type ReviewRun = {
  input: ReviewGameInput;
  sink: ReviewProgressSink;
  options: ReviewEngineOptions;
  session: UciReviewSession;
  maiaSlots: readonly MaiaSlot[];
  multipv: number;
  search: ResolvedReviewSearch;
  timeControl: ReturnType<typeof parseTimeControl>;
  /** Per move: whether it is a book move (opening theory). */
  book: readonly boolean[];
};

type AssessedMove = { move: MoveReview; assessment: MoveAssessment };

function throwIfCancelled(sink: ReviewProgressSink): void {
  if (sink.shouldCancel?.()) throw new Error("Review cancelled");
}

export async function reviewGameWithEngine(
  config: EngineConfig,
  input: ReviewGameInput,
  sink: ReviewProgressSink = {},
  {
    maiaConfigs = [],
    ...options
  }: ReviewEngineOptions & { maiaConfigs?: readonly MaiaConfig[] } = {}
): Promise<GameReview> {
  const multipv = Math.max(1, Math.min(Math.round(input.multipv ?? 3), 5));
  const search = resolveReviewSearchParams(input);
  const session = new UciReviewSession(config, sink.shouldCancel);
  let maiaSlots: MaiaSlot[] = maiaConfigs.map((cfg) => ({
    config: cfg,
    session: new UciReviewSession(cfg, sink.shouldCancel),
    alive: true
  }));

  // Taken before the engines start: a file replaced while they load may not be what they loaded.
  const stampsBeforeStart = engineFileStamps([config, ...maiaConfigs]);
  try {
    maiaSlots = await startEngines(session, maiaSlots, multipv, options);
    const maiaEngines = maiaSlots.map((slot) => ({
      rating: slot.config.maiaRating,
      engineId: slot.config.id,
      name: engineDisplayName(slot.config.name)
    }));

    // The game's book moves (opening theory) and its opening.
    const theory = classifyOpening(openingBook(), input.moves);
    const run: ReviewRun = {
      input,
      sink,
      options,
      session,
      maiaSlots,
      multipv,
      search,
      timeControl: parseTimeControl(input.timeControl),
      book: theory.book
    };
    const moves: MoveReview[] = [];
    let previousReplyLines: AnalysisLine[] | null = null;
    // Each move is assessed in the context of the one before it (the opponent's move into it).
    let previousAssessed: AssessedMove | null = null;
    // An engine file replaced during startup: this review's results are not cached under either
    // version. Otherwise they are keyed by the stamps taken before the start (what was loaded).
    const job: ReviewJob = {
      config,
      maiaConfigs: maiaSlots.map((slot) => slot.config),
      multipv,
      search,
      options
    };
    const cached = sameStamps(stampsBeforeStart, engineFileStamps([config, ...maiaConfigs]))
      ? reviewCache.job(reviewJobKey(job, stampsBeforeStart))
      : new Map<string, CachedMove>();
    for (let index = 0; index < input.moves.length; index += 1) {
      throwIfCancelled(sink);
      const reviewed = await reviewedMove(run, index, cached, {
        replyLines: previousReplyLines,
        assessed: previousAssessed
      });
      previousReplyLines = reviewed.nextTopLines;
      const moveReview = reviewed.review;
      const assessment = assessMove(moveReview, {
        previous: previousAssessed,
        playerRating: options.playerRating ?? null,
        book: theory.book[index] ?? false
      });
      const assessed: MoveReview = { ...moveReview, assessment };
      previousAssessed = { move: assessed, assessment };
      moves.push(assessed);
      sink.onMoveCompleted?.({ moveIndex: index, move: assessed, opening: theory.opening });
    }

    return {
      schemaVersion: GAME_REVIEW_SCHEMA_VERSION,
      assessmentPolicy: MOVE_ASSESSMENT_POLICY,
      engineId: config.id,
      engineName: engineDisplayName(session.engineName ?? config.name),
      engineSettings: engineSettingsOf(session, multipv, search),
      maiaEngines,
      predictionEngineIds: maiaEngines.map((engine) => engine.engineId),
      depth: search.recordDepth,
      moveTimeMs: search.recordMoveTimeMs,
      multipv,
      createdAt: Date.now(),
      summary: summarizeMoves(moves),
      moves,
      opening: theory.opening
    };
  } finally {
    session.stop();
    for (const slot of maiaSlots) slot.session.stop();
  }
}

/**
 * Starts the evaluation engine and every Maia level at once (Maia (lc0) weight loads take seconds
 * each). A broken Maia degrades the review (that level is dropped and stopped); a broken
 * evaluation engine fails it. The Maia levels that started.
 */
async function startEngines(
  session: UciReviewSession,
  maiaSlots: readonly MaiaSlot[],
  multipv: number,
  options: ReviewEngineOptions
): Promise<MaiaSlot[]> {
  const [mainStart, ...maiaStarts] = await Promise.allSettled([
    session.start({ multipv, threads: options.threads, hashMb: options.hashMb }),
    ...maiaSlots.map((slot) => slot.session.start({ policyOnly: true }))
  ]);
  if (mainStart.status === "rejected") throw mainStart.reason;
  return maiaSlots.filter((slot, index) => {
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
}

/** The engine settings a review records: Threads / Hash only when the engine took them. */
function engineSettingsOf(
  session: UciReviewSession,
  multipv: number,
  search: ResolvedReviewSearch
): GameReview["engineSettings"] {
  return {
    multipv,
    moveTimeMs: search.recordMoveTimeMs,
    depth: search.recordDepth,
    ...(session.appliedThreads !== null ? { threads: session.appliedThreads } : {}),
    ...(session.appliedHashMb !== null ? { hashMb: session.appliedHashMb } : {})
  };
}

/**
 * Move `index`'s review, unassessed: reused when this configuration reviewed the same move before,
 * else searched (and kept when complete). `nextTopLines`: its reply lines, which are the next
 * move's top lines (none after a game-ending move).
 */
async function reviewedMove(
  run: ReviewRun,
  index: number,
  cached: Map<string, CachedMove>,
  previous: { replyLines: AnalysisLine[] | null; assessed: AssessedMove | null }
): Promise<{ review: MoveReview; nextTopLines: AnalysisLine[] | null }> {
  const move = run.input.moves[index];
  const cacheKey = moveKey(move.fenBefore, move.uci, run.input.moves[index - 1]?.uci ?? null);
  const done = cached.get(cacheKey);
  if (done) {
    // Most recently used goes last (eviction takes the oldest).
    ReviewCache.put(cached, cacheKey, done, reviewCache.maxMoves);
    // Already reviewed with this configuration: reuse it (only this game's notation and clock
    // facts differ).
    return {
      review: withGameClock(
        { ...done.review, nodeId: move.nodeId, ply: move.ply, san: move.san },
        run,
        index
      ),
      nextTopLines: terminalStateForFen(move.fenAfter) ? null : done.replyLines
    };
  }
  const fresh = await reviewMove(run, index, previous.replyLines, previous.assessed);
  // Only complete results are kept: after a Maia level failed, this review's moves lack its
  // prediction, and a later review (with Maia working again) must search them afresh; a move
  // whose check failed is checked again next time. Kept unassessed: the assessment depends on the
  // move before, which another game may differ in.
  if (fresh.complete) {
    const result = { review: fresh.review, replyLines: fresh.replyLines };
    ReviewCache.put(cached, cacheKey, result, reviewCache.maxMoves);
  }
  return { review: fresh.review, nextTopLines: fresh.terminal ? null : fresh.replyLines };
}

/** The move's clock facts from this game: the clock after it and the time it took, when known. */
function withGameClock(review: MoveReview, run: ReviewRun, index: number): MoveReview {
  const move = run.input.moves[index];
  delete review.clockRemainingMs;
  delete review.timeSpentMs;
  const clock = parseClock(move.clockAfter);
  if (clock !== null) review.clockRemainingMs = clock;
  const spent = timeSpentForMove(run.input.moves, index, run.timeControl);
  if (spent !== undefined) review.timeSpentMs = spent;
  return review;
}

/** Reports the start of a phase of move `index` (see ReviewProgressSink.onPhaseProgress). */
function phaseReporter(sink: ReviewProgressSink, move: ReviewMoveInputItem, index: number) {
  const mover = statusForFen(move.fenBefore).turn;
  return (phase: ReviewProgressPhase, lines: AnalysisLine[]) =>
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
}

/**
 * Searches move `index` afresh: the position before it (reusing the previous move's reply lines,
 * the same position and settings, so one full search per ply), every live Maia level's policy,
 * the position after it, then the check it may need. `complete` when nothing was left out (every
 * Maia level answered, any check succeeded), so the result may be cached.
 */
async function reviewMove(
  run: ReviewRun,
  index: number,
  previousReplyLines: AnalysisLine[] | null,
  previousAssessed: AssessedMove | null
): Promise<{
  review: MoveReview;
  replyLines: AnalysisLine[];
  terminal: TerminalState | null;
  complete: boolean;
}> {
  const { input, sink, session, multipv, search } = run;
  const move = input.moves[index];
  const playedUci = standardCastlingUci(move.fenBefore, move.uci);
  const reportPhase = phaseReporter(sink, move, index);
  reportPhase("before", previousReplyLines ?? []);
  const topLinesPromise: Promise<AnalysisLine[]> = previousReplyLines
    ? Promise.resolve(previousReplyLines)
    : session.analyze({ fen: move.fenBefore, multipv, search, shouldCancel: sink.shouldCancel });
  const activeMaia = run.maiaSlots.filter((slot) => slot.alive);
  const maiaPromise = Promise.allSettled(
    activeMaia.map(async (slot) => ({
      slot,
      policy: await slot.session.analyzePolicy(move.fenBefore, sink.shouldCancel)
    }))
  );

  const topLines = await topLinesPromise;
  throwIfCancelled(sink);

  const terminal = terminalStateForFen(move.fenAfter);
  let replyLines: AnalysisLine[] = [];
  if (!terminal) {
    reportPhase("after", []);
    replyLines = await session.analyze({
      fen: move.fenAfter,
      multipv,
      search,
      shouldCancel: sink.shouldCancel
    });
  }

  const humanPredictions = maiaPredictions(activeMaia, await maiaPromise, {
    fen: move.fenBefore,
    playedUci,
    bestUci: topLines[0]?.pv[0] ?? null
  });
  throwIfCancelled(sink);

  const review = withGameClock(
    buildMoveReview({
      move,
      playedUci,
      topLines,
      replyLines,
      terminal,
      humanPredictions,
      previousMove: input.moves[index - 1]?.uci ?? null
    }),
    run,
    index
  );
  const checked = await checkIfNeeded(run, review, previousAssessed, index);
  return {
    review,
    replyLines,
    terminal,
    complete: checked && run.maiaSlots.every((slot) => slot.alive)
  };
}

/**
 * The Maia levels' predictions for the position. A level that errored or timed out is dropped
 * (stopped, and not asked again); the rest carry on.
 */
function maiaPredictions(
  activeMaia: readonly MaiaSlot[],
  results: readonly PromiseSettledResult<{ slot: MaiaSlot; policy: PolicyResult }>[],
  position: { fen: string; playedUci: string; bestUci: string | null }
): RatingPrediction[] {
  const predictions: RatingPrediction[] = [];
  for (const [slotIndex, result] of results.entries()) {
    if (result.status === "rejected") {
      // Settled in the order activeMaia was mapped, so this is the slot that failed.
      const slot = activeMaia[slotIndex];
      logger.warn("review", `Maia ${slot.config.maiaRating} failed; dropping it:`, result.reason);
      slot.alive = false;
      slot.session.stop();
      continue;
    }
    const { slot, policy } = result.value;
    const prediction = buildRatingPrediction({
      rating: slot.config.maiaRating,
      engineId: slot.config.id,
      fen: position.fen,
      stats: policy.stats,
      wdl: policy.wdl,
      playedUci: position.playedUci,
      bestUci: position.bestUci
    });
    if (prediction) predictions.push(prediction);
  }
  return predictions;
}

/**
 * A Great / Brilliant candidate gets a deeper search before it can be marked; an error near a
 * severity boundary, judged from a separate search, is searched again on the same budget. The
 * check is optional: when it fails (a timeout, an engine error) the move is assessed without it,
 * so it stays unverified, and the review goes on. Cancelling still stops it. False when the check
 * failed.
 */
async function checkIfNeeded(
  run: ReviewRun,
  review: MoveReview,
  previousAssessed: AssessedMove | null,
  index: number
): Promise<boolean> {
  const { sink, options } = run;
  const need = verificationNeed(review, {
    previous: previousAssessed,
    playerRating: options.playerRating ?? null,
    book: run.book[index] ?? false
  });
  if (!need) return true;
  let checked = true;
  try {
    review.verification = await verifyMove(run.session, review, need, {
      multipv: run.multipv,
      search: run.search,
      shouldCancel: sink.shouldCancel,
      timeoutMs: options.checkTimeoutMs
    });
  } catch (error) {
    if (sink.shouldCancel?.()) throw new Error("Review cancelled", { cause: error });
    checked = false;
    logger.warn(
      "review",
      `Checking ${review.san} failed; it is assessed without the check:`,
      error
    );
  }
  throwIfCancelled(sink);
  return checked;
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
    return { engineName: engineDisplayName(session.engineName ?? config.name), lines };
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
  const best = topLines.at(0);
  const after = afterMove(terminal, replyLines);
  const playedLine = topLines.find((line) => line.pv[0] === playedUci);
  const playedRank = playedLine?.multipv ?? null;
  const bestMove = best?.pv[0] ?? null;
  return {
    nodeId: move.nodeId,
    ply: move.ply,
    san: move.san,
    playedMove: playedUci,
    fenBefore: move.fenBefore,
    fenAfter: move.fenAfter,
    ...bestLineFacts(best),
    evalAfter: evalAfterMove(terminal, after.score, move.fenAfter),
    evalLoss: computeEvalLoss({ topLines, playedRank, afterScore: after.score, terminal }),
    bestMove,
    topLines,
    replyLines,
    playedRank,
    playedLineScore: playedLine?.score ?? null,
    wdlAfter: after.wdl,
    terminal,
    humanPredictions: humanPredictions.length > 0 ? humanPredictions : undefined,
    motifs: tacticalMotifsForBestMove(
      move.fenBefore,
      bestMove,
      best?.score ?? null,
      input.previousMove
    )
  };
}

/** What the engine's best line says about the position before the move (nothing without one). */
function bestLineFacts(
  best: AnalysisLine | undefined
): Pick<MoveReview, "evalBefore" | "bestEvalAfter" | "bestLine" | "wdlBefore"> {
  return {
    evalBefore: best?.scoreWhite ?? null,
    // Eval after the engine's choice = its best line from the same search.
    bestEvalAfter: best?.scoreWhite ?? null,
    bestLine: best?.pv ?? [],
    wdlBefore: best?.wdl ?? null
  };
}

/**
 * The position after the move, for the side to move there (the opponent): its score and WDL from
 * the reply search, synthesized when the game ended.
 */
function afterMove(
  terminal: TerminalState | null,
  replyLines: readonly AnalysisLine[]
): { score: EngineScore | null; wdl: Wdl | null } {
  if (terminal) return { score: terminalScore(terminal), wdl: terminalWdl(terminal) };
  const reply = replyLines.at(0);
  return { score: reply?.score ?? null, wdl: reply?.wdl ?? null };
}

/** White-perspective, except a checkmate stays `mate 0` (= side to move is mated; see `terminal`). */
function evalAfterMove(
  terminal: TerminalState | null,
  afterScore: EngineScore | null,
  fenAfter: string
): EngineScore | null {
  if (terminal === "checkmate") return { type: "mate", value: 0 };
  return afterScore ? scoreFromWhitePerspective(afterScore, statusForFen(fenAfter).turn) : null;
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
