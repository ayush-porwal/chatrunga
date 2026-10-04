import { makeFen } from "chessops/fen";
import { makeSanAndPlay } from "chessops/san";
import { parseUci } from "chessops/util";
import { fenAfterUci, positionFromFen, statusForFen } from "@chaturanga/shared/chess/position";
import { analyzeTacticsForPosition } from "@chaturanga/shared/chess/tactics";
import { buildIdeaFacts } from "@chaturanga/shared/chess/move-ideas";
import { buildRatingCurve, quantizeToBucket } from "@chaturanga/shared/chess/rating-curve";
import { formatEngineScore, scoreFromWhitePerspective, scoreToCentipawns } from "@chaturanga/shared/chess/review";
import type {
  CuratorReason,
  EngineSignal,
  EvalAssessment,
  ReviewInsightPayload,
  TacticalFact
} from "@chaturanga/shared/schemas";
import type {
  AnalysisLine,
  EngineScore,
  GameReview,
  MoveClassification,
  MoveReview,
  RatingPrediction,
  ReviewGameInput,
  Wdl
} from "@chaturanga/shared/types/engine";
import type { GameHeaders, MoveNode } from "@chaturanga/shared/types/chess";
import { MAIA_BUCKETS, type MaiaRatingBucket } from "@chaturanga/shared/schemas/rating-curve";

type ReviewMoveInput = ReviewGameInput["moves"][number];
export type ReviewTab = "commentary" | "moves" | "opening" | "engine" | "settings";

export function reviewIdFromPath(pathname: string): string {
  return pathname.match(/^\/games\/([^/]+)\/review\/?$/)?.[1] ?? "current";
}

export function mainlineReviewInput(moveTree: MoveNode[]): ReviewMoveInput[] {
  const moves: ReviewMoveInput[] = [];
  // One index for the walk (a find per step would be quadratic on long games).
  const byId = new Map(moveTree.map((item) => [item.id, item]));
  let node = byId.get("root");
  while (node?.children[0]) {
    const next = byId.get(node.children[0]);
    if (!next?.uci || !next.san) break;
    moves.push({
      nodeId: next.id,
      ply: next.ply,
      san: next.san,
      uci: next.uci,
      fenBefore: next.fenBefore,
      fenAfter: next.fenAfter,
      clockAfter: next.clockAfter ?? null
    });
    node = next;
  }
  return moves;
}

export function uciToSan(fen: string, uci: string | null | undefined): string | null {
  if (!uci) return null;
  try {
    const position = positionFromFen(fen);
    const parsed = parseUci(uci);
    if (!parsed || !position.isLegal(parsed)) return null;
    return makeSanAndPlay(position, parsed);
  } catch {
    return null;
  }
}

export function uciLineToSan(fen: string, line: readonly string[]): string[] {
  const position = positionFromFen(fen);
  const sans: string[] = [];
  for (const uci of line) {
    try {
      const parsed = parseUci(uci);
      if (!parsed || !position.isLegal(parsed)) break;
      sans.push(makeSanAndPlay(position, parsed));
    } catch {
      break;
    }
  }
  return sans;
}

/** One move of an engine line: its SAN, its UCI and the position after it. */
export type LineStep = { san: string; uci: string; fenAfter: string };

/**
 * The positions along an engine line from `fen` (stops at the first move that doesn't fit, like
 * {@link uciLineToSan}).
 */
export function uciLineSteps(fen: string, line: readonly string[]): LineStep[] {
  const position = positionFromFen(fen);
  const steps: LineStep[] = [];
  for (const uci of line) {
    try {
      const parsed = parseUci(uci);
      if (!parsed || !position.isLegal(parsed)) break;
      const san = makeSanAndPlay(position, parsed);
      steps.push({ san, uci, fenAfter: makeFen(position.toSetup()) });
    } catch {
      break;
    }
  }
  return steps;
}

/** `12. Nf3 d5 13. c4` (or `12… d5 13. c4` with Black to move first) for SAN moves played from `fen`. */
export function numberedLine(fen: string, sans: readonly string[]): string {
  const [, turn = "w", , , , fullmove = "1"] = fen.split(" ");
  let number = Number(fullmove) || 1;
  let white = turn === "w";
  const parts: string[] = [];
  sans.forEach((san, index) => {
    if (white) parts.push(`${number}. ${san}`);
    else parts.push(index === 0 ? `${number}… ${san}` : san);
    if (!white) number += 1;
    white = !white;
  });
  return parts.join(" ");
}

export function uciSquares(uci: string | null | undefined): { orig: string; dest: string } | null {
  if (!uci || uci.length < 4) return null;
  return { orig: uci.slice(0, 2), dest: uci.slice(2, 4) };
}

export function moveLabel(move: MoveReview): string {
  const number = Math.ceil(move.ply / 2);
  return move.ply % 2 === 1 ? `${number}. ${move.san}` : `${number}… ${move.san}`;
}

export function buildRatingCurveForMove(move: MoveReview, userRating: number) {
  const predictions = move.humanPredictions ?? [];
  const played = readPredictionProbabilities(predictions, move.playedMove);
  const best = readPredictionProbabilities(predictions, move.bestMove ?? "");
  return buildRatingCurve({
    playedProb: played,
    bestProb: best,
    playedIsBest: Boolean(move.bestMove && move.playedMove === move.bestMove),
    userBucket: quantizeToBucket(userRating)
  });
}

function readPredictionProbabilities(
  predictions: readonly RatingPrediction[],
  uci: string
): [number, number, number, number, number] {
  const result: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  if (!uci) return result;
  predictions.forEach((prediction) => {
    const index = MAIA_BUCKETS.indexOf(prediction.rating);
    if (index < 0) return;
    result[index] = prediction.topMoves.find((item) => item.uci === uci)?.prob ?? 0;
  });
  return result;
}

export function buildTacticalFacts(move: MoveReview): TacticalFact[] {
  const facts: TacticalFact[] = [];
  const add = (fen: string, mover: "white" | "black") => {
    try {
      // Only what the move created or left behind, not pre-existing geometry.
      facts.push(...analyzeTacticsForPosition(fen, mover, { fenBefore: move.fenBefore }));
    } catch {
      // Invalid/custom positions should not prevent the rest of the review.
    }
  };
  const mover = statusForFen(move.fenBefore).turn;
  if (move.bestMove) {
    const bestAfter = fenAfterUci(move.fenBefore, move.bestMove);
    if (bestAfter) add(bestAfter, mover);
  }
  add(move.fenAfter, mover);
  return facts.filter((fact, index, all) => {
    const key = JSON.stringify(fact);
    return all.findIndex((candidate) => JSON.stringify(candidate) === key) === index;
  });
}

export function buildEngineSignals(move: MoveReview): EngineSignal[] {
  const lines = [...move.topLines].sort((a, b) => a.multipv - b.multipv);
  if (lines.length < 2) return [];
  const best = lines[0];
  const second = lines[1];
  if (!best || !second) return [];
  const gap = Math.abs(scoreToCentipawns(best.score) - scoreToCentipawns(second.score));
  const signals: EngineSignal[] = [];
  if (best.pv.length >= 5 && gap >= 200) {
    signals.push({
      kind: "forced_sequence",
      lineLengthPly: best.pv.length,
      secondBestLossCp: -Math.round(gap)
    });
  }
  if (gap >= 400) {
    signals.push({ kind: "only_move", nextBestLossCp: -Math.round(gap) });
  }
  return signals;
}

const MISTAKE_LIKE: readonly MoveClassification[] = ["blunder", "mistake", "missed_tactic", "human_error"];
const SAN_TOKEN = /^(O-O(-O)?[+#]?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=[QRBN])?[+#]?)$/;
const RECENT_PLIES = 6;
const PIECE_VALUES: Record<string, number> = { q: 9, r: 5, b: 3, n: 3 };

type Side = "white" | "black";
type TerminalState = NonNullable<ReviewInsightPayload["game"]["terminal"]>;
type PayloadContextFields = NonNullable<ReviewInsightPayload["context"]>;

/** PGN header subset the coach payload can use. Accepts `GameHeaders` directly. */
type InsightPayloadHeaders = Partial<
  Pick<GameHeaders, "white" | "black" | "event" | "opening" | "eco" | "result" | "timeControl">
>;

/** Review-level metadata the coach payload can use (engine identity, Maia trust). */
type InsightReviewMeta = Partial<
  Pick<GameReview, "schemaVersion" | "engineName" | "engineSettings" | "depth" | "moveTimeMs">
>;

/** Whole-game context for one payload; `moves` is the review's full mainline. */
type InsightPayloadContext = {
  moves: readonly MoveReview[];
  headers?: InsightPayloadHeaders | null;
  /**
   * The saved review's metadata. Maia probabilities are only sent when
   * `schemaVersion >= 2` (older reviews carry fake uniform policies).
   */
  review?: InsightReviewMeta | null;
};

function moveNumberSanForPly(ply: number): string {
  return ply % 2 === 1 ? `${Math.ceil(ply / 2)}.` : `${Math.ceil(ply / 2)}...`;
}

function otherSide(side: Side): Side {
  return side === "white" ? "black" : "white";
}

/** Material-aware phase: trades matter more than the move number. */
function phaseFor(ply: number, fen: string): "opening" | "middlegame" | "endgame" {
  const board = fen.split(" ")[0] ?? "";
  let nonPawnMaterial = 0;
  for (const char of board.toLowerCase()) nonPawnMaterial += PIECE_VALUES[char] ?? 0;
  if (nonPawnMaterial <= 26) return "endgame";
  if (ply <= 24 && nonPawnMaterial >= 52) return "opening";
  return "middlegame";
}

function safeStatus(fen: string): ReturnType<typeof statusForFen> | null {
  try {
    return statusForFen(fen);
  } catch {
    return null;
  }
}

/** Newer reviews record the terminal state; "draw" there is insufficient material. */
function storedTerminal(move: MoveReview): TerminalState | undefined {
  if (!move.terminal) return undefined;
  return move.terminal === "draw" ? "insufficient_material" : move.terminal;
}

function terminalFor(fen: string | null | undefined): TerminalState | undefined {
  const status = fen ? safeStatus(fen) : null;
  if (!status?.isEnd) return undefined;
  if (status.isCheckmate) return "checkmate";
  if (status.isStalemate) return "stalemate";
  return "insufficient_material";
}

/** Mover-perspective centipawns, clamped so mate scores stay comparable. */
function moverCp(score: EngineScore, mover: Side): number {
  const cp = Math.max(-1000, Math.min(1000, scoreToCentipawns(score)));
  return mover === "white" ? cp : -cp;
}

function whiteCp(score: EngineScore): number {
  return Math.max(-1000, Math.min(1000, scoreToCentipawns(score)));
}

/** Verbal reading of a White-perspective score (see evalAssessmentSchema). */
export function assessScore(score: EngineScore | null | undefined): EvalAssessment | undefined {
  if (!score) return undefined;
  if (score.type === "mate") {
    if (score.value > 0) return "white_has_forced_mate";
    if (score.value < 0) return "black_has_forced_mate";
    return undefined;
  }
  const magnitude = Math.abs(score.value);
  if (magnitude <= 30) return "equal";
  const side = score.value > 0 ? "white" : "black";
  if (magnitude <= 90) return `${side}_slightly_better`;
  if (magnitude <= 200) return `${side}_clearly_better`;
  return `${side}_winning`;
}

function terminalAssessment(terminal: TerminalState, mover: Side): EvalAssessment {
  return terminal === "checkmate" ? `${mover}_won` : "draw";
}

function isSanToken(value: string | null | undefined): value is string {
  return Boolean(value && value.length >= 2 && value.length <= 10 && SAN_TOKEN.test(value));
}

function cleanHeader(value: string | null | undefined, max: number): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "?" || trimmed === "-" || trimmed === "*") return undefined;
  return trimmed.slice(0, max);
}

/** Drops undefined keys so optional fields are absent (not `undefined`) on the wire. */
function defined<T extends Record<string, unknown>>(value: T): T {
  const copy = { ...value };
  for (const key of Object.keys(copy)) if (copy[key] === undefined) delete copy[key];
  return copy;
}

function resolveEvalLoss(
  move: MoveReview,
  evalAfter: EngineScore,
  terminal: TerminalState | undefined,
  mover: Side
): number | null {
  if (terminal === "checkmate") return 0;
  if (move.evalLoss !== null && move.evalAfter) return move.evalLoss;
  const reference = move.bestEvalAfter ?? move.evalBefore;
  if (!reference) return null;
  return Math.max(0, Math.min(1000, moverCp(reference, mover) - moverCp(evalAfter, mover)));
}

function buildAlternatives(move: MoveReview, mover: Side) {
  const lines = [...move.topLines].sort((a, b) => a.multipv - b.multipv).slice(0, 3);
  const alternatives: NonNullable<ReviewInsightPayload["engines"]["stockfish"]["alternatives"]> = [];
  lines.forEach((line, index) => {
    const san = uciToSan(move.fenBefore, line.pv[0]);
    if (!isSanToken(san)) return;
    const score = line.scoreWhite ?? scoreFromWhitePerspective(line.score, mover);
    alternatives.push(
      defined({
        rank: index + 1,
        san,
        eval: formatEngineScore(score),
        lineSan: uciLineToSan(move.fenBefore, line.pv).slice(0, 6),
        isPlayed: line.pv[0] === move.playedMove ? true : undefined
      })
    );
  });
  const playedIndex = lines.findIndex((line) => line.pv[0] === move.playedMove);
  return {
    alternatives: alternatives.length >= 2 ? alternatives : undefined,
    playedMoveRank: playedIndex >= 0 ? playedIndex + 1 : undefined
  };
}

function buildHumanTopMoves(move: MoveReview, bucket: MaiaRatingBucket) {
  const prediction = move.humanPredictions?.find((item) => item.rating === bucket);
  if (!prediction) return undefined;
  const moves = prediction.topMoves
    .slice(0, 3)
    .map((item) => ({ san: uciToSan(move.fenBefore, item.uci), prob: Math.round(item.prob * 100) / 100 }))
    .filter((item): item is { san: string; prob: number } => isSanToken(item.san));
  // A flat distribution (e.g. every candidate at 0.2) carries no signal; omit it
  // rather than let the coach read meaning into it.
  const probs = moves.map((item) => item.prob);
  if (!moves.length || Math.max(...probs) - Math.min(...probs) < 0.02) return undefined;
  return { rating: bucket, moves };
}

function findPly(moves: readonly MoveReview[], ply: number): MoveReview | undefined {
  return moves.find((item) => item.ply === ply);
}

function buildClock(move: MoveReview, context: InsightPayloadContext | undefined) {
  if (move.clockRemainingMs === undefined) return undefined;
  const toSec = (ms: number) => Math.max(0, Math.min(86_400, Math.round(ms / 1000)));
  const previousOwn = context ? findPly(context.moves, move.ply - 2) : undefined;
  const opponent = context ? findPly(context.moves, move.ply - 1) : undefined;
  // Time spent = own clock after the previous own move − own clock now + increment.
  const increment = Number(context?.headers?.timeControl?.match(/^\d+\+(\d+)$/)?.[1] ?? 0);
  const spentMs =
    previousOwn?.clockRemainingMs !== undefined
      ? previousOwn.clockRemainingMs - move.clockRemainingMs + increment * 1000
      : undefined;
  return defined({
    moverRemainingSec: toSec(move.clockRemainingMs),
    moverSpentSec: spentMs === undefined ? undefined : toSec(spentMs),
    opponentRemainingSec:
      opponent?.clockRemainingMs === undefined ? undefined : toSec(opponent.clockRemainingMs)
  });
}

function evalTrend(points: readonly number[]): PayloadContextFields["trend"] {
  if (points.length < 3) return undefined;
  const first = points[0] ?? 0;
  const last = points[points.length - 1] ?? 0;
  const delta = last - first;
  const range = Math.max(...points) - Math.min(...points);
  if (Math.abs(delta) >= 100) return delta > 0 ? "white_improving" : "black_improving";
  if (range >= 250) return "swinging";
  return "stable";
}

function buildGameContext(
  move: MoveReview,
  mover: Side,
  context: InsightPayloadContext
): PayloadContextFields {
  const ordered = [...context.moves].sort((a, b) => a.ply - b.ply);
  const previous = ordered.filter((item) => item.ply < move.ply);
  const recent = previous.slice(-RECENT_PLIES);
  const sideForPly = (ply: number): Side => ((move.ply - ply) % 2 === 0 ? mover : otherSide(mover));

  const recentMoves = recent
    .filter((item) => isSanToken(item.san))
    .map((item) =>
      defined({
        moveNumberSan: moveNumberSanForPly(item.ply),
        san: item.san,
        mover: sideForPly(item.ply),
        classification: item.classification,
        evalAfter: item.evalAfter ? formatEngineScore(item.evalAfter) : undefined
      })
    );

  const trendPoints = [
    ...(recent[0]?.evalBefore ? [whiteCp(recent[0].evalBefore)] : []),
    ...recent.flatMap((item) => (item.evalAfter ? [whiteCp(item.evalAfter)] : []))
  ];

  const emptyCount = () => ({ inaccuracies: 0, mistakes: 0, blunders: 0 });
  const mistakesSoFar = { white: emptyCount(), black: emptyCount() };
  for (const item of previous) {
    const bucket = mistakesSoFar[sideForPly(item.ply)];
    if (item.classification === "inaccuracy") bucket.inaccuracies += 1;
    else if (item.classification === "blunder") bucket.blunders += 1;
    else if (MISTAKE_LIKE.includes(item.classification)) bucket.mistakes += 1;
  }

  const next = findPly(ordered, move.ply + 1);
  const actualReply =
    next && next.fenBefore === move.fenAfter && isSanToken(next.san)
      ? defined({
          moveNumberSan: moveNumberSanForPly(next.ply),
          san: next.san,
          classification: next.classification,
          matchesEngine: Boolean(next.bestMove && next.playedMove === next.bestMove) || next.classification === "best"
        })
      : undefined;

  const headers = context.headers ?? {};
  const white = cleanHeader(headers.white, 60);
  const black = cleanHeader(headers.black, 60);
  const eco = cleanHeader(headers.eco, 10);
  const openingName = cleanHeader(headers.opening, 90);
  const opening = [eco, openingName].filter(Boolean).join(" ").slice(0, 100) || undefined;
  const headerResult = cleanHeader(headers.result, 10);
  const last = ordered[ordered.length - 1];
  const finalResult = last ? safeStatus(last.fenAfter)?.result : undefined;
  const result = [headerResult, finalResult].find(
    (value): value is "1-0" | "0-1" | "1/2-1/2" => value === "1-0" || value === "0-1" || value === "1/2-1/2"
  );

  return defined({
    players: white || black ? defined({ white, black }) : undefined,
    event: cleanHeader(headers.event, 80),
    opening,
    timeControl: cleanHeader(headers.timeControl, 20),
    result,
    totalPlies: ordered.length > 0 ? Math.min(1200, ordered.length) : undefined,
    recentMoves: recentMoves.length ? recentMoves : undefined,
    trend: evalTrend(trendPoints),
    mistakesSoFar,
    actualReply
  });
}

/**
 * Engine's best continuation after the played move. Newer reviews store the
 * fenAfter search as `replyLines`; older ones only have it as the next ply's
 * best line.
 */
function replyUciFor(move: MoveReview, context: InsightPayloadContext | undefined): string[] | undefined {
  const stored = move.replyLines?.find((line) => line.multipv === 1) ?? move.replyLines?.[0];
  if (stored?.pv.length) return stored.pv;
  if (!context) return undefined;
  const next = findPly(context.moves, move.ply + 1);
  if (!next || next.fenBefore !== move.fenAfter || next.bestLine.length === 0) return undefined;
  return next.bestLine;
}

function replyLineFor(move: MoveReview, context: InsightPayloadContext | undefined): string[] | undefined {
  const uci = replyUciFor(move, context);
  if (!uci?.length) return undefined;
  const line = uciLineToSan(move.fenAfter, uci).slice(0, 8);
  return line.length ? line : undefined;
}

type WinChance = { win: number; draw: number; loss: number };

/** Permille WDL -> whole percent, optionally flipped to the other side's view. */
function toWinChance(wdl: Wdl | null | undefined, flip: boolean): WinChance | undefined {
  if (!wdl) return undefined;
  const total = wdl.win + wdl.draw + wdl.loss;
  if (!(total > 0)) return undefined;
  const pct = (value: number) => Math.max(0, Math.min(100, Math.round((value / total) * 100)));
  const win = pct(flip ? wdl.loss : wdl.win);
  const loss = pct(flip ? wdl.win : wdl.loss);
  return { win, draw: Math.max(0, 100 - win - loss), loss };
}

function engineMeta(move: MoveReview, review: InsightReviewMeta | null | undefined) {
  const bestLine = [...move.topLines].sort((a, b) => a.multipv - b.multipv)[0];
  const depth = bestLine?.depth && bestLine.depth > 0 ? Math.min(250, Math.round(bestLine.depth)) : undefined;
  const moveTimeMs = review?.engineSettings?.moveTimeMs ?? review?.moveTimeMs ?? undefined;
  const before = toWinChance(move.wdlBefore ?? bestLine?.wdl, false);
  // wdlAfter is from the opponent's side (to move after the played move).
  const after = toWinChance(move.wdlAfter, true);
  return {
    engineName: review?.engineName?.trim().slice(0, 60) || undefined,
    depth,
    moveTimeMs: moveTimeMs && moveTimeMs > 0 ? Math.round(moveTimeMs) : undefined,
    winChance: before || after ? defined({ before, after }) : undefined
  };
}

type HumanLikelihood = "most_likely" | "common" | "plausible" | "unusual" | "rare";

function likelihood(prob: number | undefined, rank: number | undefined): HumanLikelihood | undefined {
  if (prob === undefined && rank === undefined) return undefined;
  if (rank === 1) return "most_likely";
  const p = prob ?? 0;
  if (p >= 0.15) return "common";
  if (p >= 0.05) return "plausible";
  if (p >= 0.01) return "unusual";
  return "rare";
}

function probOf(prediction: RatingPrediction, uci: string | null | undefined, stored: number | undefined): number | undefined {
  if (stored !== undefined && Number.isFinite(stored)) return Math.max(0, Math.min(1, stored));
  if (!uci) return undefined;
  return prediction.topMoves.find((item) => item.uci === uci)?.prob;
}

function rankOf(prediction: RatingPrediction, uci: string | null | undefined, stored: number | undefined): number | undefined {
  if (stored !== undefined && stored >= 1) return Math.min(300, Math.round(stored));
  if (!uci) return undefined;
  const index = prediction.topMoves.findIndex((item) => item.uci === uci);
  return index >= 0 ? index + 1 : undefined;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Real per-level Maia evidence. Only trusted for reviews with
 * `schemaVersion >= 2`; older reviews stored a fake uniform policy.
 */
function buildMaiaEvidence(move: MoveReview, userRating: number, trusted: boolean) {
  if (!trusted) return undefined;
  const predictions = (move.humanPredictions ?? [])
    .filter((prediction) => (MAIA_BUCKETS as readonly number[]).includes(prediction.rating))
    .sort((a, b) => a.rating - b.rating);
  if (!predictions.length) return undefined;
  const levels = predictions.map((prediction) => {
    const playedProb = probOf(prediction, move.playedMove, prediction.playedProb);
    const bestProb = move.bestMove ? probOf(prediction, move.bestMove, prediction.bestProb) : undefined;
    const top = prediction.topMoves
      .slice(0, 3)
      .map((item) => ({ san: uciToSan(move.fenBefore, item.uci), prob: round2(item.prob) }))
      .filter((item): item is { san: string; prob: number } => isSanToken(item.san));
    return defined({
      rating: prediction.rating,
      playedProb: playedProb === undefined ? undefined : round2(playedProb),
      playedRank: rankOf(prediction, move.playedMove, prediction.playedRank),
      bestProb: bestProb === undefined ? undefined : round2(bestProb),
      bestRank: move.bestMove ? rankOf(prediction, move.bestMove, prediction.bestRank) : undefined,
      top
    });
  });
  const nearest = predictions.reduce((closest, prediction) =>
    Math.abs(prediction.rating - userRating) < Math.abs(closest.rating - userRating) ? prediction : closest
  );
  const nearestLevel = levels.find((level) => level.rating === nearest.rating);
  return defined({
    playerLevel: nearest.rating,
    playedAtPlayerLevel: likelihood(nearestLevel?.playedProb, nearestLevel?.playedRank),
    bestAtPlayerLevel:
      move.bestMove && move.bestMove !== move.playedMove
        ? likelihood(nearestLevel?.bestProb, nearestLevel?.bestRank)
        : undefined,
    levels
  });
}

/**
 * Build the grounded coach payload for one reviewed move.
 *
 * Pass `context` (the whole review's moves + PGN headers) so the coach also
 * sees recent history, the engine's reply to the played move, what was actually
 * played next, and game metadata. Returns null only when the engine produced no
 * usable best move / evaluation for the position.
 */
export function buildInsightPayload(
  move: MoveReview,
  userRating: number,
  commentaryDetail: CommentaryDetail = "balanced",
  playerColor: Side = "white",
  context?: InsightPayloadContext
): ReviewInsightPayload | null {
  const bestMoveSan = uciToSan(move.fenBefore, move.bestMove);
  const bestLineSan = uciLineToSan(move.fenBefore, move.bestLine).slice(0, 8);
  if (!bestMoveSan || bestLineSan.length === 0 || !move.evalBefore || !isSanToken(move.san)) return null;
  const mover = statusForFen(move.fenBefore).turn;
  const afterStatus = safeStatus(move.fenAfter);
  const terminal = storedTerminal(move) ?? terminalFor(move.fenAfter);
  // A finished game has no engine search after the move (no PV), so the review
  // stores no evalAfter. Synthesize it from the terminal state instead of
  // dropping the move: M0 = side to move is mated, 0.00 = drawn.
  const evalAfter: EngineScore | null =
    move.evalAfter ??
    (terminal === "checkmate" ? { type: "mate", value: 0 } : terminal ? { type: "cp", value: 0 } : null);
  if (!evalAfter) return null;
  const evalLoss = resolveEvalLoss(move, evalAfter, terminal, mover);
  if (evalLoss === null) return null;

  const curve = buildRatingCurveForMove(move, userRating);
  const trustedMaia = (context?.review?.schemaVersion ?? 0) >= 2;
  const usableMaia = trustedMaia && hasUsableMaiaData(move);
  if (!usableMaia) curve.interpretation = { label: "neutral" };
  // Any mate-in-one is objectively best even if it was not the engine's first PV.
  const classification: MoveClassification = terminal === "checkmate" ? "best" : move.classification;
  const reason: CuratorReason = MISTAKE_LIKE.includes(classification)
    ? "mistake"
    : move.playedMove === move.bestMove && usableMaia
      ? "difficult_find"
      : "move_review";

  const bestTerminal = move.bestMove ? terminalFor(fenAfterUci(move.fenBefore, move.bestMove)) : undefined;
  const assessmentBefore = assessScore(move.evalBefore);
  const assessmentAfter = terminal ? terminalAssessment(terminal, mover) : assessScore(evalAfter);
  const assessmentAfterBest = bestTerminal
    ? terminalAssessment(bestTerminal, mover)
    : assessScore(move.bestEvalAfter);
  const { alternatives, playedMoveRank } = buildAlternatives(move, mover);
  const replyLineSan = move.playedMove !== move.bestMove && !terminal ? replyLineFor(move, context) : undefined;
  const motifs = move.motifs.filter((motif) => motif.length > 0 && motif.length <= 30).slice(0, 6);
  const clock = buildClock(move, context);
  const phase = phaseFor(move.ply, move.fenBefore);
  const ideas = buildIdeaFacts({
    fenBefore: move.fenBefore,
    playedUci: move.playedMove,
    bestUci: move.bestMove,
    bestLine: move.bestLine,
    replyLine: replyLineSan ? replyUciFor(move, context) : undefined,
    early: phase === "opening" || move.ply <= 30
  });
  const maia = buildMaiaEvidence(move, userRating, trustedMaia);

  return defined({
    schemaVersion: 1 as const,
    player: {
      rating: userRating,
      color: playerColor,
      ratingBucket: curve.userRatingBucket
    },
    game: defined({
      ply: move.ply,
      moveNumberSan: moveNumberSanForPly(move.ply),
      san: move.san,
      mover,
      fenBefore: move.fenBefore,
      fenAfter: move.fenAfter,
      phase,
      givesCheck: afterStatus?.isCheck ? true : undefined,
      terminal
    }),
    engines: defined({
      stockfish: defined({
        evalBefore: formatEngineScore(move.evalBefore),
        evalAfter: formatEngineScore(evalAfter),
        evalLossCp: Math.max(0, Math.round(evalLoss)),
        bestMoveSan,
        bestLineSan,
        evalPerspective: "white" as const,
        bestEvalAfter: move.bestEvalAfter ? formatEngineScore(move.bestEvalAfter) : undefined,
        assessment:
          assessmentBefore && assessmentAfter
            ? defined({ before: assessmentBefore, after: assessmentAfter, afterBest: assessmentAfterBest })
            : undefined,
        alternatives,
        playedMoveRank: move.playedRank ?? playedMoveRank,
        replyLineSan,
        ...engineMeta(move, context?.review)
      }),
      maiaCurve: curve,
      humanTopMoves: trustedMaia ? buildHumanTopMoves(move, maia?.playerLevel ?? curve.userRatingBucket) : undefined,
      maia
    }),
    classification,
    curatorReason: reason,
    tacticalFacts: buildTacticalFacts(move),
    engineSignals: buildEngineSignals(move),
    bestMoveMotifs: motifs.length ? motifs : undefined,
    clock: clock && Object.keys(clock).length ? clock : undefined,
    context: context ? buildGameContext(move, mover, context) : undefined,
    ideas: ideas ?? undefined,
    commentaryDetail
  });
}

export type CommentaryDetail = "concise" | "balanced" | "detailed";

export function hasUsableMaiaData(move: MoveReview): boolean {
  const ratings = new Set((move.humanPredictions ?? []).map((prediction) => prediction.rating));
  // A single bucket cannot support a rating curve; avoid presenting zero-filled
  // unavailable buckets as real probabilities.
  return ratings.size === MAIA_BUCKETS.length;
}

export function averageLoss(moves: readonly MoveReview[]): number | null {
  const values = moves.map((move) => move.evalLoss).filter((value): value is number => value !== null);
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

export function reviewAccuracy(moves: readonly MoveReview[]): number | null {
  const loss = averageLoss(moves);
  return loss === null ? null : Math.max(0, Math.min(100, Math.round(100 - loss / 8)));
}

export function countByClassification(moves: readonly MoveReview[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const move of moves) counts[move.classification] = (counts[move.classification] ?? 0) + 1;
  return counts;
}

export function lineDelta(line: AnalysisLine, best: AnalysisLine | undefined): string {
  if (!best) return "—";
  const delta = scoreToCentipawns(line.score) - scoreToCentipawns(best.score);
  return `${delta > 0 ? "+" : ""}${(delta / 100).toFixed(1)}`;
}
