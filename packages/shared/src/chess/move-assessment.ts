/**
 * Move assessment for game review: an objective evaluation of every move, the severity of its
 * error, and an optional coaching mark that most moves don't get.
 *
 * Errors follow Lichess's winning-chances model (`WinPercent` below; its Advice thresholds of
 * 0.1 / 0.2 / 0.3 on a [-1, 1] scale are 5 / 10 / 15 percentage points), with its separate rules
 * for moves that allow or let slip a forced mate. Book moves (opening theory, from the bundled
 * opening book; chess/opening-book.ts) are marked Book and never judged. Praise is our own policy
 * and deliberately conservative: an engine match earns nothing by itself, forced replies,
 * recaptures and moves in decided positions are never praised, and Great / Brilliant need a
 * deeper search that agrees. Missing or disagreeing analysis gives no mark.
 *
 * Pure (no engine or process access): main assesses moves as a review runs, and saved reviews
 * from an older policy are re-assessed from their stored evaluations when they load.
 */
import type { Square } from "chessops/types";
import { parseSquare, parseUci, squareRank } from "chessops/util";
import type {
  AnalysisLine,
  AssessmentTag,
  EngineScore,
  ErrorSeverity,
  GameReview,
  GameReviewSummary,
  MoveAnnotation,
  MoveAssessment,
  MoveReview,
  RatingPrediction,
  TerminalState
} from "../types/engine";
import { classifyOpening, type OpeningBook } from "./opening-book";
import { positionFromFen, statusForFen } from "./position";
import { scoreFromWhitePerspective, terminalStateForFen } from "./review";

/**
 * Version of the rules below. Bump it whenever a threshold or rule changes: saved reviews from
 * another version are re-assessed (and say so) when they load.
 */
export const MOVE_ASSESSMENT_POLICY = 3;

/** Lichess's WinPercent slope (scalachess eval.scala). */
const WIN_MULTIPLIER = 0.00368208;
/** Centipawns are clamped here before conversion, and a forced mate counts as this much. */
const CP_CEILING = 1000;

/** Winning-chances drops (percentage points) at which a move becomes each error. */
export const SEVERITY_THRESHOLDS: Readonly<Record<ErrorSeverity, number>> = {
  inaccuracy: 5,
  mistake: 10,
  blunder: 15
};

/** Praise needs the played move within this many points of the best one. */
const NEAR_BEST = 2;
/** Great: every other candidate is at least a Lichess Mistake worse than the played move. */
const GREAT_GAP = SEVERITY_THRESHOLDS.mistake;
/** Excellent and Good: the other candidates are at least an Inaccuracy worse. */
const CHOICE_GAP = SEVERITY_THRESHOLDS.inaccuracy;
/** From this many points the game is decided for the mover (about +6): no praise for converting. */
const DECIDED_WIN = 90;
/** At or below this the game is lost for the mover: an inaccuracy there is not worth a mark. */
const DECIDED_LOSS = 10;
/** Great keeps a game the mover can still fight for (about -2.3 or better). */
const FIGHTING_WIN = 30;
/** Brilliant: after the sacrifice the mover is at least equal. */
const SOUND_WIN = 50;
/** Miss: the opponent's error had made the mover clearly better (about +1.1). */
const OPPORTUNITY_WIN = 60;
/** A sacrifice gives up at least this much material (the exchange, or a piece for a pawn). */
const SACRIFICE_POINTS = 2;
/** Maia: a move this likely at the player's level is obvious, not a find. */
const OBVIOUS_PROBABILITY = 0.5;
/** Maia: a near-best move this unlikely at the player's level is hard to find. */
const HARD_PROBABILITY = 0.1;
/** Motifs of the engine's best move that count as a tactic found (an undefended capture doesn't). */
const TACTICAL_MOTIFS = new Set(["fork", "pin", "skewer", "winning capture", "forced mate"]);
/** Within this many points of a severity boundary, an error from a separate search is rechecked. */
const RECHECK_MARGIN = 1.5;

const PIECE_POINTS = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 } as const;

/** Lichess WinPercent: the mover's winning chances (0–100) for a centipawn score. */
export function winPercent(cp: number): number {
  const clamped = Math.max(-CP_CEILING, Math.min(CP_CEILING, cp));
  return 100 / (1 + Math.exp(-WIN_MULTIPLIER * clamped));
}

/** An evaluation from the mover's point of view (`moverMates`: who has the forced mate). */
export type MoverEval = { kind: "cp"; cp: number } | { kind: "mate"; moverMates: boolean };

/**
 * A side-to-move engine score as the mover sees it. `mate N` with N > 0: the side to move mates;
 * N < 0 or `mate 0` (checkmated already): it is mated.
 */
function moverEval(score: EngineScore, moverToMove: boolean): MoverEval {
  if (score.type === "cp") return { kind: "cp", cp: moverToMove ? score.value : -score.value };
  const sideToMoveMates = score.value > 0;
  return { kind: "mate", moverMates: moverToMove ? sideToMoveMates : !sideToMoveMates };
}

function moverWin(value: MoverEval): number {
  if (value.kind === "cp") return winPercent(value.cp);
  return winPercent(value.moverMates ? CP_CEILING : -CP_CEILING);
}

function lineWin(line: AnalysisLine): number {
  return moverWin(moverEval(line.score, true));
}

type SeverityResult = {
  severity: ErrorSeverity | null;
  mateTag: "mate_created" | "mate_lost" | null;
};

/**
 * Severity of a move from the mover's evaluation before it (best play) and after it.
 * Mate transitions follow Lichess's MateAdvice: letting a forced mate slip, or allowing one, is
 * judged by the centipawn score on the other side of the transition; a mate that only gets longer
 * (or a mate the mover was already facing) is no error. Otherwise the winning-chances drop decides.
 */
export function severityFor(before: MoverEval, after: MoverEval): SeverityResult {
  if (before.kind === "mate") {
    if (!before.moverMates) return { severity: null, mateTag: null };
    if (after.kind === "mate" && after.moverMates) return { severity: null, mateTag: null };
    const next = after.kind === "cp" ? after.cp : 0;
    return {
      severity: next > 999 ? "inaccuracy" : next > 700 ? "mistake" : "blunder",
      mateTag: "mate_lost"
    };
  }
  if (after.kind === "mate") {
    if (after.moverMates) return { severity: null, mateTag: null };
    const previous = before.cp;
    return {
      severity: previous < -999 ? "inaccuracy" : previous < -700 ? "mistake" : "blunder",
      mateTag: "mate_created"
    };
  }
  return {
    severity: severityForLoss(Math.max(0, moverWin(before) - moverWin(after))),
    mateTag: null
  };
}

/** Severity for a winning-chances drop in percentage points. */
export function severityForLoss(loss: number): ErrorSeverity | null {
  if (loss >= SEVERITY_THRESHOLDS.blunder) return "blunder";
  if (loss >= SEVERITY_THRESHOLDS.mistake) return "mistake";
  if (loss >= SEVERITY_THRESHOLDS.inaccuracy) return "inaccuracy";
  return null;
}

/** What an assessment reads from a reviewed move. */
export type AssessableMove = Pick<
  MoveReview,
  "ply" | "fenBefore" | "fenAfter" | "playedMove" | "bestMove" | "topLines" | "evalAfter" | "motifs"
> &
  Partial<Pick<MoveReview, "replyLines" | "terminal" | "humanPredictions" | "verification">>;

export type AssessmentContext = {
  /** The ply before, when it is the opponent's move into this position, with its assessment. */
  previous?: { move: AssessableMove; assessment: MoveAssessment } | null;
  /** The player's rating: picks the Maia level whose difficulty counts. */
  playerRating?: number | null;
  /** Maia probabilities are real (reviews with schemaVersion 2+). */
  trustMaia?: boolean;
  /** The move is opening theory: a book move (see classifyOpening). */
  book?: boolean;
};

type Evidence = {
  /** The before-search's MultiPV lines, best first. */
  lines: AnalysisLine[];
  before: MoverEval;
  after: MoverEval;
  /** The played move's own line in the before-search, when it was in the MultiPV window. */
  playedLine: AnalysisLine | null;
};

function sortedLines(lines: readonly AnalysisLine[] | undefined): AnalysisLine[] {
  return [...(lines ?? [])]
    .filter((line) => line.pv.length > 0)
    .sort((a, b) => a.multipv - b.multipv);
}

function terminalOf(move: AssessableMove): TerminalState | null {
  return move.terminal ?? terminalStateForFen(move.fenAfter);
}

function moverOf(fen: string): "white" | "black" | null {
  try {
    return statusForFen(fen).turn;
  } catch {
    return null;
  }
}

/**
 * The evaluations the assessment compares, from the most consistent source available: the played
 * move's line in the same search as the best move, else a same-budget search of only the played
 * move, else the search after it (or the stored White-perspective evaluation of older reviews).
 */
function evidenceFor(move: AssessableMove): Evidence | null {
  const lines = sortedLines(move.topLines);
  const best = lines[0];
  const mover = moverOf(move.fenBefore);
  if (!best || !mover) return null;
  const before = moverEval(best.score, true);
  const playedLine = lines.find((line) => line.pv[0] === move.playedMove) ?? null;
  const terminal = terminalOf(move);
  const checkedLine = move.verification?.playedLine;
  const reply = sortedLines(move.replyLines)[0];
  let after: MoverEval | null = null;
  if (terminal === "checkmate") after = { kind: "mate", moverMates: true };
  else if (terminal) after = { kind: "cp", cp: 0 };
  else if (playedLine) after = moverEval(playedLine.score, true);
  else if (checkedLine && checkedLine.pv[0] === move.playedMove)
    after = moverEval(checkedLine.score, true);
  else if (reply) after = moverEval(reply.score, false);
  else if (move.evalAfter)
    after = moverEval(scoreFromWhitePerspective(move.evalAfter, mover), true);
  return after ? { lines, before, after, playedLine } : null;
}

/**
 * Legal moves in a position (0 when it can't be read). A pawn reaching the last rank is four moves,
 * one for each piece it can promote to.
 */
function legalMoveCount(fen: string): number {
  try {
    const pos = positionFromFen(fen);
    let count = 0;
    for (const [from, dests] of pos.allDests()) {
      const pawn = pos.board.get(from)?.role === "pawn";
      for (const to of dests) count += pawn && [0, 7].includes(squareRank(to)) ? 4 : 1;
    }
    return count;
  } catch {
    return 0;
  }
}

function squareOf(uci: string, index: 0 | 2): Square | undefined {
  return parseSquare(uci.slice(index, index + 2));
}

/** The move takes back on the square where the opponent's previous move just captured. */
function isRecapture(move: AssessableMove, previous: AssessableMove | null): boolean {
  if (!previous) return false;
  const target = squareOf(move.playedMove, 2);
  if (target === undefined || squareOf(previous.playedMove, 2) !== target) return false;
  try {
    // The previous move captured there (a piece of this move's side stood on the square)…
    const victim = positionFromFen(previous.fenBefore).board.get(target);
    const mover = moverOf(move.fenBefore);
    // …and this move captures the piece that did it.
    const capturer = positionFromFen(move.fenBefore).board.get(target);
    return Boolean(
      victim && mover && victim.color === mover && capturer && capturer.color !== mover
    );
  } catch {
    return false;
  }
}

function materialBalance(
  pos: ReturnType<typeof positionFromFen>,
  color: "white" | "black"
): number {
  let balance = 0;
  for (const [, piece] of pos.board)
    balance += (piece.color === color ? 1 : -1) * PIECE_POINTS[piece.role];
  return balance;
}

/**
 * Material (in pawns) the mover is down along `line` (the move first, then the engine's best
 * defence), net of anything the move itself took: after the reply, and still after the mover's
 * next move when the line has one (the smaller of the two, so material won straight back doesn't
 * count). Null when the line doesn't fit the position, or stops before the reply: what the move
 * takes would count without the recapture the line doesn't show.
 */
function materialGiven(fenBefore: string, line: readonly string[]): number | null {
  if (line.length < 2) return null;
  try {
    const pos = positionFromFen(fenBefore);
    const mover = pos.turn;
    const start = materialBalance(pos, mover);
    const given: number[] = [];
    for (const uci of line.slice(0, 3)) {
      const move = parseUci(uci);
      if (!move || !pos.isLegal(move)) return null;
      pos.play(move);
      given.push(start - materialBalance(pos, mover));
    }
    if (given.length >= 3) return Math.min(given[1] ?? 0, given[2] ?? 0);
    return given[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Material (in pawns) the played move gives up by choice: what its line loses (see materialGiven;
 * it needs the reply and the mover's next move to tell) beyond the other candidate that loses the
 * least. Material every candidate loses — a fork, a pinned or trapped piece — is a forced loss, not
 * a sacrifice; with no other candidate to compare (none whose line shows the reply), nothing counts.
 */
export function sacrificedMaterial(
  fenBefore: string,
  line: readonly string[],
  alternatives: readonly (readonly string[])[]
): number {
  if (line.length < 3) return 0;
  const given = materialGiven(fenBefore, line);
  const kept = alternatives
    .map((alternative) => materialGiven(fenBefore, alternative))
    .filter((value) => value !== null);
  if (given === null || given <= 0 || !kept.length) return 0;
  return Math.max(0, given - Math.min(...kept));
}

type Candidate = {
  kind: "brilliant" | "great" | null;
  /** Played move's winning chances against the best other candidate's (null: none). */
  gap: number | null;
  /** The other candidates lose material the played move keeps (a rescue, not a find by itself). */
  savesMaterial: boolean;
};

/**
 * Whether one search's lines make the played move a Great or Brilliant candidate: within
 * {@link NEAR_BEST} of the best line, and either far better than every other candidate while
 * keeping a fighting game (Great), or a sacrifice that leaves the mover at least equal (Brilliant).
 */
function candidateFrom(lines: readonly AnalysisLine[], move: AssessableMove): Candidate {
  const sorted = sortedLines(lines);
  const best = sorted[0];
  const played = sorted.find((line) => line.pv[0] === move.playedMove);
  if (!best || !played) return { kind: null, gap: null, savesMaterial: false };
  const playedWin = lineWin(played);
  const others = sorted.filter((line) => line !== played);
  const gap = others.length ? playedWin - Math.max(...others.map(lineWin)) : null;
  const playedGiven = materialGiven(move.fenBefore, played.pv);
  const othersGiven = others
    .map((line) => materialGiven(move.fenBefore, line.pv))
    .filter((value) => value !== null);
  const savesMaterial =
    playedGiven !== null && othersGiven.length > 0 && Math.min(...othersGiven) - playedGiven >= 1;
  if (lineWin(best) - playedWin > NEAR_BEST) return { kind: null, gap, savesMaterial };
  const sacrifice =
    sacrificedMaterial(
      move.fenBefore,
      played.pv,
      others.map((line) => line.pv)
    ) >= SACRIFICE_POINTS;
  if (sacrifice && playedWin >= SOUND_WIN) return { kind: "brilliant", gap, savesMaterial };
  if (gap !== null && gap >= GREAT_GAP && playedWin >= FIGHTING_WIN)
    return { kind: "great", gap, savesMaterial };
  return { kind: null, gap, savesMaterial };
}

/** The Maia level nearest the player's rating (1500 when unknown), among those that ran. */
function predictionAtLevel(
  predictions: readonly RatingPrediction[] | undefined,
  rating: number | null | undefined
): RatingPrediction | null {
  if (!predictions?.length) return null;
  const target = typeof rating === "number" && Number.isFinite(rating) ? rating : 1500;
  return (
    [...predictions].sort(
      (a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target) || a.rating - b.rating
    )[0] ?? null
  );
}

function probabilityOf(prediction: RatingPrediction, uci: string): number | null {
  if (typeof prediction.playedProb === "number" && Number.isFinite(prediction.playedProb))
    return prediction.playedProb;
  return prediction.topMoves.find((item) => item.uci === uci)?.prob ?? null;
}

/**
 * What a move needs checked before it can be assessed with confidence (main runs the search):
 * - "candidate": it may be Great or Brilliant, which a deeper search must confirm;
 * - "recheck": it was outside the MultiPV window and its loss sits near a severity boundary, so a
 *   same-budget search of only the played move gives a consistent evaluation.
 * It applies the same exclusions as {@link assessMove} (pass the same context), so no search is
 * run for a mark that could never be given.
 */
export type VerificationNeed = "candidate" | "recheck";

export function verificationNeed(
  move: AssessableMove,
  context: AssessmentContext = {}
): VerificationNeed | null {
  const evidence = evidenceFor(move);
  if (!evidence || terminalOf(move) || context.book) return null;
  const winBefore = moverWin(evidence.before);
  if (evidence.playedLine) {
    const gate = praiseGate(move, evidence, context);
    return gate.excludedBy === null && candidateFor(evidence.lines, move, gate).kind
      ? "candidate"
      : null;
  }
  if (move.verification?.playedLine !== undefined) return null;
  if (evidence.before.kind === "mate" || evidence.after.kind === "mate") return null;
  const loss = Math.max(0, winBefore - moverWin(evidence.after));
  const nearBoundary = Object.values(SEVERITY_THRESHOLDS).some(
    (threshold) => Math.abs(loss - threshold) <= RECHECK_MARGIN
  );
  return nearBoundary ? "recheck" : null;
}

/** What decides whether a move without an error may be praised, and how. */
type PraiseGate = {
  /** The first exclusion that rules out every positive mark but Good (null: none). */
  excludedBy: "forced" | "recapture" | "near_best" | "decided" | null;
  /** The opponent's mistake or blunder gave something away (they weren't already lost before it). */
  opponentErred: boolean;
  /** The Maia level read for this move (null: no Maia evidence). */
  prediction: RatingPrediction | null;
  /** Maia's most likely move at the player's level is the played one. */
  naturalMove: boolean;
  /** …and that likely: the move is obvious, not a find. */
  obvious: boolean;
  /** The played move is the engine's best and carries a real tactic. */
  tactic: boolean;
};

function praiseGate(
  move: AssessableMove,
  evidence: Evidence,
  context: AssessmentContext
): PraiseGate {
  const { lines, before, after, playedLine } = evidence;
  const winBefore = moverWin(before);
  const winLoss = Math.max(0, winBefore - moverWin(after));
  const previous =
    context.previous && context.previous.move.fenAfter === move.fenBefore ? context.previous : null;
  const opponentErred =
    (previous?.assessment.severity === "mistake" || previous?.assessment.severity === "blunder") &&
    (previous.assessment.winBefore ?? 0) > DECIDED_LOSS;
  const prediction =
    context.trustMaia === false
      ? null
      : predictionAtLevel(move.humanPredictions, context.playerRating);
  const humanTop = prediction?.topMoves[0] ?? null;
  const naturalMove = Boolean(humanTop && humanTop.uci === move.playedMove);
  const engineTop = lines[0]?.pv[0] === move.playedMove;
  const excludedBy =
    legalMoveCount(move.fenBefore) < 2
      ? "forced"
      : isRecapture(move, previous?.move ?? null)
        ? "recapture"
        : !playedLine || winLoss > NEAR_BEST
          ? "near_best"
          : winBefore >= DECIDED_WIN
            ? "decided"
            : null;
  return {
    excludedBy,
    opponentErred,
    prediction,
    naturalMove,
    obvious: naturalMove && humanTop !== null && humanTop.prob >= OBVIOUS_PROBABILITY,
    tactic: engineTop && move.motifs.some((motif) => TACTICAL_MOTIFS.has(motif))
  };
}

/**
 * The Great / Brilliant candidate one search's lines make of the move, once the move is cleared
 * for praise: never the obvious move at the player's level, and — without Maia to say it was hard
 * to find — never a move whose only merit is keeping material the other candidates lose (a piece
 * rescued, a loss avoided) unless it is itself a tactic.
 */
function candidateFor(
  lines: readonly AnalysisLine[],
  move: AssessableMove,
  gate: PraiseGate
): Candidate & { blocked: boolean } {
  const candidate = candidateFrom(lines, move);
  if (!candidate.kind) return { ...candidate, blocked: false };
  const rescueOnly =
    candidate.kind === "great" &&
    candidate.savesMaterial &&
    gate.prediction === null &&
    !gate.tactic;
  if (gate.obvious || rescueOnly) return { ...candidate, kind: null, blocked: true };
  return { ...candidate, blocked: false };
}

/** Rounds to one decimal (assessments are stored and shown at that precision). */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Assesses one move. `context.previous` is the opponent's move into this position (Miss, Good and
 * recaptures depend on it); `context.book` makes it a book move, marked Book whatever it cost.
 */
export function assessMove(move: AssessableMove, context: AssessmentContext = {}): MoveAssessment {
  const tags = new Set<AssessmentTag>();
  if (context.book) tags.add("book");
  const evidence = evidenceFor(move);
  if (!evidence) {
    tags.add("incomplete");
    return {
      policy: MOVE_ASSESSMENT_POLICY,
      winBefore: null,
      winAfter: null,
      winLoss: null,
      alternativeGap: null,
      severity: null,
      annotation: context.book ? "book" : null,
      tags: [...tags]
    };
  }
  const { lines, before, after, playedLine } = evidence;
  const winBefore = moverWin(before);
  const winAfter = moverWin(after);
  const winLoss = Math.max(0, winBefore - winAfter);
  const engineTop = lines[0]?.pv[0] === move.playedMove;
  if (engineTop) tags.add("engine_top");
  const otherWins = playedLine ? lines.filter((line) => line !== playedLine).map(lineWin) : [];
  // Replaced by the deeper search's gap when that search confirms a Great or Brilliant mark.
  let alternativeGap =
    playedLine && otherWins.length ? lineWin(playedLine) - Math.max(...otherWins) : null;
  const result = (
    severity: ErrorSeverity | null,
    annotation: MoveAnnotation | null
  ): MoveAssessment => ({
    policy: MOVE_ASSESSMENT_POLICY,
    winBefore: round1(winBefore),
    winAfter: round1(winAfter),
    winLoss: round1(winLoss),
    alternativeGap: alternativeGap === null ? null : round1(alternativeGap),
    severity,
    annotation,
    tags: [...tags]
  });
  // Opening theory is never an error, a mark of praise or a key moment.
  if (context.book) return result(null, "book");

  const gate = praiseGate(move, evidence, context);
  const { opponentErred, prediction } = gate;
  if (gate.naturalMove) tags.add("natural_move");

  const { severity, mateTag } = severityFor(before, after);
  if (mateTag) tags.add(mateTag);
  if (severity) {
    if (
      move.bestMove &&
      move.bestMove !== move.playedMove &&
      move.motifs.some((motif) => motif.length > 0)
    ) {
      tags.add("missed_tactic");
    }
    if (opponentErred && severity !== "inaccuracy" && winBefore >= OPPORTUNITY_WIN) {
      tags.add("missed_chance");
      return result(severity, "miss");
    }
    if (severity === "inaccuracy" && (winAfter >= DECIDED_WIN || winBefore <= DECIDED_LOSS)) {
      tags.add("decided");
      return result(severity, null);
    }
    return result(severity, severity);
  }

  // No error: praise only what clears every exclusion (the same ones verificationNeed applies).
  switch (gate.excludedBy) {
    case "forced":
    case "recapture":
      tags.add(gate.excludedBy);
      return result(null, null);
    case "near_best":
      return result(null, null);
    case "decided":
    case null:
      break;
  }
  if (opponentErred) tags.add("punishes_error");
  const punishes =
    opponentErred &&
    ((alternativeGap !== null && alternativeGap >= CHOICE_GAP) ||
      (engineTop && move.motifs.length > 0));
  if (gate.excludedBy === "decided") {
    tags.add("decided");
    return result(null, punishes ? "good" : null);
  }

  const candidate = candidateFor(lines, move, gate);
  if (candidate.blocked && candidate.savesMaterial && !gate.obvious) tags.add("saves_material");
  if (candidate.kind) {
    const deeper = move.verification?.deeperLines;
    if (!deeper?.length) {
      tags.add("unverified");
    } else {
      const confirmed = candidateFor(deeper, move, gate);
      if (confirmed.kind) alternativeGap = confirmed.gap;
      if (confirmed.kind === "brilliant") {
        tags.add("sacrifice");
        return result(null, "brilliant");
      }
      if (confirmed.kind === "great") {
        tags.add("only_move");
        return result(null, "great");
      }
      tags.add("unstable");
    }
  }

  const choiceMattered = alternativeGap !== null && alternativeGap >= CHOICE_GAP;
  const playedProbability = prediction ? probabilityOf(prediction, move.playedMove) : null;
  const hardToFind = playedProbability !== null && playedProbability < HARD_PROBABILITY;
  if (engineTop && choiceMattered && (gate.tactic || hardToFind)) {
    if (gate.tactic) tags.add("tactic");
    if (hardToFind) tags.add("hard_to_find");
    return result(null, "excellent");
  }
  return result(null, punishes ? "good" : null);
}

/** Options for assessing a whole line: its book moves come from `openingBook` (none without one). */
export type LineAssessmentOptions = Omit<AssessmentContext, "previous" | "book"> & {
  openingBook?: OpeningBook | null;
};

/**
 * Assesses a game's main line in order (from its start position), each move in the context of the
 * move before it.
 */
export function assessMoves(
  moves: readonly (AssessableMove & Pick<MoveReview, "san">)[],
  options: LineAssessmentOptions = {}
): MoveAssessment[] {
  const { openingBook, ...context } = options;
  const book = openingBook ? classifyOpening(openingBook, moves).book : [];
  const assessments: MoveAssessment[] = [];
  moves.forEach((move, index) => {
    const previousMove = moves[index - 1];
    const previousAssessment = assessments[index - 1];
    assessments.push(
      assessMove(move, {
        ...context,
        book: book[index] ?? false,
        previous:
          previousMove && previousAssessment
            ? { move: previousMove, assessment: previousAssessment }
            : null
      })
    );
  });
  return assessments;
}

/**
 * A saved review with assessments under the current policy: unchanged when it already has them,
 * else re-assessed from its stored evaluations and flagged `assessmentsRecomputed` (no deeper
 * search runs here, so nothing that needs one is marked), with its summary counted again and its
 * book moves and opening classified from `openingBook` (kept as they were without one). Saved
 * reviews come from older builds: a move too damaged to assess stays unassessed (unmarked) and the
 * rest keep their marks.
 */
export function withCurrentAssessments(
  review: GameReview,
  options: Pick<AssessmentContext, "playerRating"> & { openingBook?: OpeningBook | null } = {}
): GameReview {
  const current =
    review.assessmentPolicy === MOVE_ASSESSMENT_POLICY &&
    review.moves.every((move) => move.assessment?.policy === MOVE_ASSESSMENT_POLICY);
  if (current) return review;
  const trustMaia = (review.schemaVersion ?? 0) >= 2;
  const theory = options.openingBook ? classifyOpeningSafely(options.openingBook, review) : null;
  let previous: AssessmentContext["previous"] = null;
  const moves = review.moves.map((move, index): MoveReview => {
    const { assessment: stale, ...rest } = move;
    void stale;
    try {
      const assessment = assessMove(move, {
        playerRating: options.playerRating,
        trustMaia,
        book: theory?.book[index] ?? false,
        previous
      });
      previous = { move, assessment };
      return { ...rest, assessment };
    } catch {
      previous = null;
      return rest;
    }
  });
  return {
    ...review,
    moves,
    summary: summarizeMoves(moves),
    ...(theory ? { opening: theory.opening } : {}),
    assessmentPolicy: MOVE_ASSESSMENT_POLICY,
    assessmentsRecomputed: true
  };
}

/** A saved review's book moves and opening; none when its moves can't be read as a line. */
function classifyOpeningSafely(book: OpeningBook, review: GameReview) {
  try {
    return classifyOpening(book, review.moves);
  } catch {
    return { book: [], opening: null };
  }
}

/**
 * Counts for a review's summary. Errors count by severity (marked or not), so shortening what the
 * review highlights never changes them; positives count by mark.
 */
export function summarizeMoves(moves: readonly MoveReview[]): GameReviewSummary {
  const summary: GameReviewSummary = {
    totalMoves: moves.length,
    book: 0,
    best: 0,
    brilliant: 0,
    great: 0,
    excellent: 0,
    good: 0,
    misses: 0,
    inaccuracies: 0,
    mistakes: 0,
    blunders: 0,
    missedTactics: 0,
    humanErrors: 0,
    averageCentipawnLoss: null
  };
  let lossSum = 0;
  let lossCount = 0;
  for (const move of moves) {
    // Saved reviews come from older builds too: only real numbers count.
    if (typeof move.evalLoss === "number" && Number.isFinite(move.evalLoss)) {
      lossSum += move.evalLoss;
      lossCount += 1;
    }
    const assessment = move.assessment;
    if (!assessment) continue;
    if (assessment.tags.includes("engine_top")) summary.best += 1;
    switch (assessment.severity) {
      case "inaccuracy":
        summary.inaccuracies += 1;
        break;
      case "mistake":
        summary.mistakes += 1;
        break;
      case "blunder":
        summary.blunders += 1;
        break;
      case null:
        break;
    }
    if (assessment.severity && assessment.tags.includes("missed_tactic"))
      summary.missedTactics += 1;
    if (assessment.severity && assessment.tags.includes("natural_move"))
      summary.humanErrors = (summary.humanErrors ?? 0) + 1;
    switch (assessment.annotation) {
      case "book":
        summary.book = (summary.book ?? 0) + 1;
        break;
      case "brilliant":
        summary.brilliant = (summary.brilliant ?? 0) + 1;
        break;
      case "great":
        summary.great = (summary.great ?? 0) + 1;
        break;
      case "excellent":
        summary.excellent += 1;
        break;
      case "good":
        summary.good += 1;
        break;
      case "miss":
        summary.misses = (summary.misses ?? 0) + 1;
        break;
      case "inaccuracy":
      case "mistake":
      case "blunder":
      case null:
        break;
    }
  }
  summary.averageCentipawnLoss = lossCount ? Math.round(lossSum / lossCount) : null;
  return summary;
}

/** The mark a move shows (null: unmarked, including moves not yet assessed). */
export function annotationOf(
  move: Pick<MoveReview, "assessment"> | null | undefined
): MoveAnnotation | null {
  return move?.assessment?.annotation ?? null;
}

/** The move's error severity, whether or not it is marked. */
export function severityOf(
  move: Pick<MoveReview, "assessment"> | null | undefined
): ErrorSeverity | null {
  return move?.assessment?.severity ?? null;
}

export function annotationLabel(annotation: MoveAnnotation): string {
  switch (annotation) {
    case "book":
      return "Book";
    case "brilliant":
      return "Brilliant";
    case "great":
      return "Great";
    case "excellent":
      return "Excellent";
    case "good":
      return "Good";
    case "miss":
      return "Miss";
    case "inaccuracy":
      return "Inaccuracy";
    case "mistake":
      return "Mistake";
    case "blunder":
      return "Blunder";
  }
}

/**
 * The mark's glyph: the standard NAGs where one exists (!!, !, ?!, ?, ??); Excellent, Good, Miss
 * and Book have none, so they use symbols that read as no NAG ("!!" is never used for Excellent).
 * Book's is a text stand-in: the badges draw it as an open book icon.
 */
export function annotationGlyph(annotation: MoveAnnotation): string {
  switch (annotation) {
    case "book":
      return "📖";
    case "brilliant":
      return "!!";
    case "great":
      return "!";
    case "excellent":
      return "★";
    case "good":
      return "✓";
    case "miss":
      return "✗";
    case "inaccuracy":
      return "?!";
    case "mistake":
      return "?";
    case "blunder":
      return "??";
  }
}

export function severityLabel(severity: ErrorSeverity): string {
  switch (severity) {
    case "inaccuracy":
      return "Inaccuracy";
    case "mistake":
      return "Mistake";
    case "blunder":
      return "Blunder";
  }
}

/** "12%" for a percentage-point amount (whole points; "<1%" for a sliver). */
function points(value: number): string {
  const rounded = Math.round(value);
  return rounded < 1 ? "<1%" : `${rounded}%`;
}

/**
 * One plain sentence saying why a move carries its mark, built only from the assessment's own
 * facts. An unmarked move gets none, except an error left unmarked because the game was decided.
 * `cost: false` leaves out what an error cost ("It cost 12% of the winning chances."): an error
 * with nothing else to say then gets none.
 */
export function assessmentReason(
  assessment: MoveAssessment | null | undefined,
  { cost = true }: { cost?: boolean } = {}
): string | null {
  if (!assessment) return null;
  const tags = new Set(assessment.tags);
  const loss = assessment.winLoss ?? 0;
  const lost = cost ? `It cost ${points(loss)} of the winning chances.` : null;
  if (!assessment.annotation) {
    return assessment.severity && tags.has("decided")
      ? `${severityLabel(assessment.severity)} in a game that was already decided, so it isn't marked.`
      : null;
  }
  switch (assessment.annotation) {
    case "book":
      return "Opening theory: a move from the opening book.";
    case "brilliant":
      return "A sound sacrifice: it gives up material and holds against the best defence, confirmed by a deeper search.";
    case "great":
      return `A critical find: every other move the engine checked was at least ${points(assessment.alternativeGap ?? GREAT_GAP)} worse, confirmed by a deeper search.`;
    case "excellent":
      return tags.has("tactic")
        ? "Finds the tactic: near-best, and the other candidates were clearly worse."
        : "Near-best and hard to find at your level; the other candidates were clearly worse.";
    case "good":
      return "Punishes the opponent's error and keeps what it gave.";
    case "miss":
      return lost
        ? `Gives back the chance the opponent's error created. ${lost}`
        : "Gives back the chance the opponent's error created.";
    case "inaccuracy":
    case "mistake":
    case "blunder":
      if (tags.has("mate_created")) return "Allows a forced mate.";
      if (tags.has("mate_lost")) return "Lets a forced mate slip.";
      return lost;
  }
}
