/**
 * Pure helpers for the game-review pipeline (no process / Electron access), so
 * they can be unit-tested with captured engine output.
 */
import type {
  AnalysisLine,
  EngineConfig,
  EngineInfo,
  EngineScore,
  MaiaRating,
  RatingPrediction,
  TerminalState,
  Wdl
} from "@chaturanga/shared/types/engine";
import { isManagedEngine } from "@chaturanga/shared/engine/managed";
import type { Lc0MoveStat } from "@chaturanga/shared/engine/uci";
import { parseUci } from "chessops/util";
import { fenAfterUci, positionFromFen, statusForFen } from "@chaturanga/shared/chess/position";
import {
  MATE_CENTIPAWNS,
  invertScore,
  scoreFromWhitePerspective,
  scoreToCentipawns,
  standardCastlingUci
} from "@chaturanga/shared/chess/review";
import { analyzeTacticsForPosition } from "@chaturanga/shared/chess/tactics";
import { isOneOf } from "@chaturanga/shared/types/guards";

export const MAIA_RATINGS: readonly MaiaRating[] = [1100, 1300, 1500, 1700, 1900];
const MAIA_TOP_MOVES = 10;
/** Same clamp the classifier has always used. */
const MAX_EVAL_LOSS = 1000;

// ─── Maia engine selection ─────────────────────────────────────────────────

/** Rating bucket for a Maia engine: explicit tag, else a `maia-1500`-style weights/name. */
export function maiaRatingForEngine(
  config: Pick<EngineConfig, "maiaRating" | "name" | "weightsPath">
): MaiaRating | undefined {
  if (config.maiaRating) return config.maiaRating;
  return maiaRatingFromText(`${config.name} ${config.weightsPath ?? ""}`);
}

/** Matches `maia-1500`, `Maia 1900`, `maia_1100.pb.gz` — never a bare number inside another net's name. */
export function maiaRatingFromText(text: string): MaiaRating | undefined {
  const match = text.toLowerCase().match(/maia[\s_-]*(1100|1300|1500|1700|1900)(?!\d)/);
  const rating = match ? Number(match[1]) : null;
  return isOneOf(MAIA_RATINGS, rating) ? rating : undefined;
}

/**
 * Picks at most one runnable Maia engine per rating: available, rating known,
 * within `levels` (null = all). When a managed download and a user-added
 * engine claim the same rating, the managed one wins (its paths are known-good).
 */
export function selectMaiaEnginesForReview(
  candidates: readonly EngineConfig[],
  levels: readonly number[] | null
): (EngineConfig & { maiaRating: MaiaRating })[] {
  const byRating = new Map<MaiaRating, EngineConfig & { maiaRating: MaiaRating }>();
  for (const candidate of candidates) {
    if (!candidate.isAvailable) continue;
    const rating = maiaRatingForEngine(candidate);
    if (!rating) continue;
    if (levels && !levels.includes(rating)) continue;
    const existing = byRating.get(rating);
    if (!existing || (!isManagedEngine(existing) && isManagedEngine(candidate))) {
      byRating.set(rating, { ...candidate, maiaRating: rating });
    }
  }
  return [...byRating.values()].sort((a, b) => a.maiaRating - b.maiaRating);
}

// ─── Engine output → review data ───────────────────────────────────────────

/**
 * Final MultiPV lines from the info stream of one search. Bound (lower/upper)
 * lines are skipped because their score is not exact. Later lines replace
 * earlier ones for the same multipv index.
 */
export function linesFromInfoStream(fen: string, infos: readonly EngineInfo[]): AnalysisLine[] {
  const turn = statusForFen(fen).turn;
  const latest = new Map<number, { info: EngineInfo; score: EngineScore }>();
  for (const info of infos) {
    if (!info.score || !info.pv?.length) continue;
    if (/\b(lowerbound|upperbound)\b/.test(info.raw)) continue;
    latest.set(info.multipv ?? 1, { info, score: info.score });
  }
  return [...latest.entries()]
    .sort(([left], [right]) => left - right)
    .map(([multipv, { info, score }]) => {
      const line: AnalysisLine = {
        multipv,
        depth: info.depth ?? 0,
        score,
        scoreWhite: scoreFromWhitePerspective(score, turn),
        pv: info.pv!.map((uci, index) => (index === 0 ? standardCastlingUci(fen, uci) : uci))
      };
      if (info.seldepth !== undefined) line.seldepth = info.seldepth;
      if (info.nodes !== undefined) line.nodes = info.nodes;
      if (info.wdl) line.wdl = info.wdl;
      return line;
    });
}

/**
 * RatingPrediction from one Maia `go nodes 1` run with VerboseMoveStats. Every
 * legal move is listed with its policy prior P; the root `node` line carries
 * the value head V. `wdl` comes from the regular `info depth 1 ... wdl` line.
 */
export function buildRatingPrediction(input: {
  rating: MaiaRating;
  engineId?: string;
  fen: string;
  stats: readonly Lc0MoveStat[];
  wdl?: Wdl;
  playedUci: string;
  bestUci: string | null;
}): RatingPrediction | null {
  const moves = input.stats
    .filter((stat) => stat.move !== "node")
    .map((stat) => ({ uci: standardCastlingUci(input.fen, stat.move), prob: stat.p }))
    .sort((a, b) => b.prob - a.prob);
  if (moves.length === 0) return null;
  const root = input.stats.find((stat) => stat.move === "node");
  const playedIndex = moves.findIndex((move) => move.uci === input.playedUci);
  const bestIndex = input.bestUci ? moves.findIndex((move) => move.uci === input.bestUci) : -1;
  const prediction: RatingPrediction = {
    rating: input.rating,
    topMoves: moves
      .slice(0, MAIA_TOP_MOVES)
      .map((move) => ({ uci: move.uci, prob: round4(move.prob) })),
    playedProb: playedIndex >= 0 ? round4(moves[playedIndex].prob) : 0
  };
  if (playedIndex >= 0) prediction.playedRank = playedIndex + 1;
  if (bestIndex >= 0) {
    prediction.bestProb = round4(moves[bestIndex].prob);
    prediction.bestRank = bestIndex + 1;
  }
  if (root?.v !== null && root?.v !== undefined) prediction.value = root.v;
  if (input.wdl) prediction.wdl = input.wdl;
  if (input.engineId) prediction.engineId = input.engineId;
  return prediction;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

// ─── Terminal positions ────────────────────────────────────────────────────

/**
 * Synthesized side-to-move score for a finished position: the side to move is
 * mated (`mate 0`) or it is a draw (`cp 0`). Engines print no PV here.
 */
export function terminalScore(terminal: TerminalState): EngineScore {
  return terminal === "checkmate" ? { type: "mate", value: 0 } : { type: "cp", value: 0 };
}

export function terminalWdl(terminal: TerminalState): Wdl {
  return terminal === "checkmate"
    ? { win: 0, draw: 0, loss: 1000 }
    : { win: 0, draw: 1000, loss: 0 };
}

// ─── Move quality ──────────────────────────────────────────────────────────

/** Centipawns for the mover from a side-to-move-AFTER score (the opponent's perspective). */
function moverCpFromAfter(scoreAfter: EngineScore): number {
  if (scoreAfter.type === "mate" && scoreAfter.value === 0) return MATE_CENTIPAWNS; // mover delivered mate
  return scoreToCentipawns(invertScore(scoreAfter));
}

/**
 * Centipawn loss of the played move, mover perspective, clamped to [0, 1000].
 *
 * - Played move inside the MultiPV window → best line vs played line of the
 *   SAME search (identical budget, no horizon mismatch).
 * - Otherwise → best line of the before-search vs the after-search of the
 *   played move (both at the full review budget).
 * - Played move mates → 0.
 */
export function computeEvalLoss(input: {
  topLines: readonly AnalysisLine[];
  playedRank: number | null;
  /** Side-to-move score of fenAfter (opponent's perspective); synthesized when terminal. */
  afterScore: EngineScore | null;
  terminal: TerminalState | null;
}): number | null {
  if (input.terminal === "checkmate") return 0;
  const best = input.topLines[0];
  if (!best) return null;
  const bestCp = scoreToCentipawns(best.score);
  let playedCp: number | null = null;
  if (input.playedRank !== null) {
    const played = input.topLines.find((line) => line.multipv === input.playedRank);
    if (played) playedCp = scoreToCentipawns(played.score);
  }
  if (playedCp === null && input.afterScore) playedCp = moverCpFromAfter(input.afterScore);
  if (playedCp === null) return null;
  return Math.max(0, Math.min(MAX_EVAL_LOSS, bestCp - playedCp));
}

// ─── Tactics ───────────────────────────────────────────────────────────────

/**
 * Real tactical motifs created by the engine's best move — the only motifs
 * that justify a "missed tactic": mate, a fork/pin/skewer by the moved piece,
 * taking a hanging piece, or a capture that wins material. Plain trades,
 * checks and "large advantage" are not tactics.
 */
export function tacticalMotifsForBestMove(
  fenBefore: string,
  bestMove: string | null,
  bestScore: EngineScore | null,
  /** The opponent's previous move (UCI); taking back on its square is a recapture, not a tactic. */
  previousMove?: string | null
): string[] {
  if (!bestMove) return [];
  const afterFen = fenAfterUci(fenBefore, bestMove);
  if (!afterFen) return [];
  const motifs = new Set<string>();
  const mover = statusForFen(fenBefore).turn;
  const to = bestMove.slice(2, 4);

  if (statusForFen(afterFen).isCheckmate) motifs.add("checkmate");
  else if (bestScore?.type === "mate" && bestScore.value > 0) motifs.add("forced mate");

  const isRecapture = Boolean(previousMove && previousMove.slice(2, 4) === to);
  const capture = isRecapture ? null : captureGain(fenBefore, bestMove);
  if (capture === "hanging") motifs.add("hanging");
  else if (capture === "winning") motifs.add("winning capture");
  // Geometry created by the moved piece itself (pre-existing pins don't count).
  for (const fact of analyzeTacticsForPosition(afterFen, mover)) {
    if (fact.kind === "fork" && fact.attacker.square === to) {
      // A real fork hits two pieces that are each worth more than the forker (or the king).
      const attackerValue = PIECE_VALUE[fact.attacker.role];
      const valuable = fact.targets.filter(
        (t) => t.role === "king" || PIECE_VALUE[t.role] > attackerValue
      );
      if (valuable.length >= 2) motifs.add("fork");
    }
    if (fact.kind === "pin" && fact.pinner.square === to) motifs.add("pin");
    if (fact.kind === "skewer" && fact.attacker.square === to) motifs.add("skewer");
  }
  return [...motifs];
}

const PIECE_VALUE: Record<string, number> = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
  king: 0
};

/**
 * "hanging" = the move captures an undefended piece; "winning" = it captures a
 * defended piece worth more than the capturer. Plain even trades → null.
 */
function captureGain(fen: string, uci: string): "hanging" | "winning" | null {
  const move = parseUci(uci);
  if (!move || !("from" in move)) return null;
  const pos = positionFromFen(fen);
  const mover = pos.board.get(move.from);
  const victim = pos.board.get(move.to);
  if (!mover || !victim || victim.color === mover.color || victim.role === "king") return null;
  const occupied = pos.board.occupied.without(move.from);
  const defenders = pos.kingAttackers(move.to, victim.color, occupied);
  if (defenders.isEmpty()) return "hanging";
  return PIECE_VALUE[victim.role] > PIECE_VALUE[mover.role] ? "winning" : null;
}
