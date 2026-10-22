import {
  GAME_REVIEW_SCHEMA_VERSION,
  type AnalysisLine,
  type EngineConfig,
  type EngineScore,
  type GameOpening,
  type GameReview,
  type MoveAssessment,
  type MoveReview,
  type MoveVerification,
  type RatingPrediction,
  type ReviewGameInput,
  type ReviewMoveInputItem,
  type ReviewProgressPhase,
  type ReviewSideRating,
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
import {
  maia3Prediction,
  type Maia3Evaluator,
  type Maia3Output
} from "@chaturanga/shared/engine/maia3";
import { logger } from "../logger";
import { openingBook } from "./opening-book";
import {
  deeperReviewSearch,
  resolveReviewSearchParams,
  type ResolvedReviewSearch
} from "./review-search";
import {
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
import { UciReviewSession } from "./uci-review-session";

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
   * Fires once per move, after the evaluation engine and Maia have reported. `opening`
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
  /**
   * How long an optional check search (see verifyMove) may take before the move is left unverified
   * and the review goes on. Defaults to the search's own timeout.
   */
  checkTimeoutMs?: number;
};

/** Finished moves of earlier reviews (see ReviewCache). */
const reviewCache = new ReviewCache();

/**
 * Maia 3 for a review: the evaluator, the model's version and the rating each side's moves are read
 * at (eloSelf = eloOppo = it; see resolveReviewSideRatings).
 */
export type ReviewMaia = {
  evaluator: Maia3Evaluator;
  modelVersion: string;
  ratings: { white: ReviewSideRating; black: ReviewSideRating };
};

/** Everything a move's review depends on besides the move itself (see reviewJobKey). */
type ReviewJob = {
  config: EngineConfig;
  maia: ReviewMaia | null;
  multipv: number;
  search: ResolvedReviewSearch;
  options: ReviewEngineOptions;
};

/**
 * The cache key of a review job. `stamps` are the engine's file stamps as they were loaded (see
 * engineFileStamps), not read again here.
 */
function reviewJobKey(
  { config, maia, multipv, search, options }: ReviewJob,
  stamps: ReadonlyMap<EngineConfig, readonly (string | null)[]>
): string {
  return JSON.stringify([
    GAME_REVIEW_SCHEMA_VERSION,
    MOVE_ASSESSMENT_POLICY,
    [
      config.id,
      config.executablePath,
      config.args,
      config.weightsPath,
      stamps.get(config) ?? null,
      config.updatedAt
    ],
    maia ? [maia.modelVersion, maia.ratings.white.rating, maia.ratings.black.rating] : null,
    multipv,
    search,
    options.threads ?? null,
    options.hashMb ?? null
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

/**
 * Maia 3 during a review. Its first failure drops it for the rest of the review (`alive`); the
 * review's abort signal stops its queued requests when the review is cancelled or ends.
 */
type MaiaRun = ReviewMaia & { alive: boolean; signal: AbortSignal };

/** A review in progress: its engines and settings, and the game's facts every move reads. */
type ReviewRun = {
  input: ReviewGameInput;
  sink: ReviewProgressSink;
  options: ReviewEngineOptions;
  session: UciReviewSession;
  maia: MaiaRun | null;
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

/** How often a running review checks whether it was cancelled, to abort its Maia requests. */
const CANCEL_POLL_MS = 100;

export async function reviewGameWithEngine(
  config: EngineConfig,
  input: ReviewGameInput,
  sink: ReviewProgressSink = {},
  { maia = null, ...options }: ReviewEngineOptions & { maia?: ReviewMaia | null } = {}
): Promise<GameReview> {
  const multipv = Math.max(1, Math.min(Math.round(input.multipv ?? 3), 5));
  const search = resolveReviewSearchParams(input);
  const session = new UciReviewSession(config, sink.shouldCancel);
  // Aborted when the review is cancelled or ends, so Maia requests still queued are dropped.
  const aborter = new AbortController();
  const cancelWatch = setInterval(() => {
    if (sink.shouldCancel?.()) aborter.abort(new Error("Review cancelled"));
  }, CANCEL_POLL_MS);
  const maiaRun: MaiaRun | null = maia ? { ...maia, alive: true, signal: aborter.signal } : null;

  // Taken before the engine starts: a file replaced while it loads may not be what it loaded.
  const stampsBeforeStart = engineFileStamps([config]);
  try {
    await session.start({ multipv, threads: options.threads, hashMb: options.hashMb });

    // The game's book moves (opening theory) and its opening.
    const theory = classifyOpening(openingBook(), input.moves);
    const run: ReviewRun = {
      input,
      sink,
      options,
      session,
      maia: maiaRun,
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
    const job: ReviewJob = { config, maia, multipv, search, options };
    const cached = sameStamps(stampsBeforeStart, engineFileStamps([config]))
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
        book: theory.book[index] ?? false
      });
      const assessed: MoveReview = { ...moveReview, assessment };
      previousAssessed = { move: assessed, assessment };
      moves.push(assessed);
      sink.onMoveCompleted?.({ moveIndex: index, move: assessed, opening: theory.opening });
    }
    throwIfCancelled(sink);

    return {
      schemaVersion: GAME_REVIEW_SCHEMA_VERSION,
      assessmentPolicy: MOVE_ASSESSMENT_POLICY,
      engineId: config.id,
      engineName: engineDisplayName(session.engineName ?? config.name),
      engineSettings: engineSettingsOf(session, multipv, search),
      ...maiaRecord(maia, moves),
      depth: search.recordDepth,
      moveTimeMs: search.recordMoveTimeMs,
      multipv,
      createdAt: Date.now(),
      summary: summarizeMoves(moves),
      moves,
      opening: theory.opening
    };
  } finally {
    clearInterval(cancelWatch);
    aborter.abort(new Error("Review ended"));
    session.stop();
  }
}

/** How a review records Maia 3, when it read any move. */
function maiaRecord(
  maia: ReviewMaia | null,
  moves: readonly MoveReview[]
): Pick<GameReview, "maia"> {
  if (!maia || !moves.some((move) => move.moverPrediction)) return {};
  return {
    maia: {
      model: "maia3",
      modelVersion: maia.modelVersion,
      white: maia.ratings.white,
      black: maia.ratings.black
    }
  };
}

/**
 * Maia 3's answer for `fen`, read at the side to move's rating (as eloSelf and eloOppo). Null
 * without Maia, after it was dropped, or when the review was cancelled; a failure drops Maia for the
 * rest of the review (the review goes on without it). Never rejects.
 */
async function maiaAnswer(
  maia: MaiaRun | null,
  fen: string
): Promise<{ output: Maia3Output; rating: number } | null> {
  if (!maia?.alive) return null;
  const rating = maia.ratings[statusForFen(fen).turn].rating;
  try {
    const outputs = await maia.evaluator.evaluate([{ fen, eloSelf: rating, eloOppo: rating }], {
      priority: "review",
      signal: maia.signal
    });
    const output = outputs.at(0);
    if (!output) throw new Error("Maia 3 gave no answer");
    return { output, rating };
  } catch (error) {
    if (maia.signal.aborted) return null;
    maia.alive = false;
    logger.warn("review", "Maia 3 failed; the review goes on without it:", error);
    return null;
  }
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
  // Only complete results are kept: after Maia failed, this review's moves lack its
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
 * the same position and settings, so one full search per ply) while Maia 3 reads it at the mover's
 * rating, the position after it, then the check it may need. `complete` when nothing was left out
 * (Maia answered when it runs, any check succeeded), so the result may be cached.
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
  const maiaPromise = maiaAnswer(run.maia, move.fenBefore);

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

  const maia = await maiaPromise;
  throwIfCancelled(sink);
  const moverPrediction = maia
    ? maia3Prediction({
        output: maia.output,
        fen: move.fenBefore,
        rating: maia.rating,
        playedUci,
        bestUci: topLines[0]?.pv[0] ?? null
      })
    : undefined;

  const review = withGameClock(
    buildMoveReview({
      move,
      playedUci,
      topLines,
      replyLines,
      terminal,
      moverPrediction,
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
    complete: checked && (run.maia === null || moverPrediction !== undefined)
  };
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
  moverPrediction: RatingPrediction | undefined;
  previousMove: string | null;
}): MoveReview {
  const { move, playedUci, topLines, replyLines, terminal, moverPrediction } = input;
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
    ...(moverPrediction ? { moverPrediction } : {}),
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
