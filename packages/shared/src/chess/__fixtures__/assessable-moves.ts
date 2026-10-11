/** Moves to assess, built from engine lines, and the positions the assessment tests use. */
import type { MoveAssessment } from "../../types/engine";
import type { AssessableMove, MoverEval } from "../move-assessment";
import { applySan, START_FEN } from "../position";
import { parseLine } from "./trap-game";

export const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
/** Greek gift: Bxh7+ Kxh7 Ng5+ gives a bishop for a pawn. */
export const GREEK_GIFT = "r1bq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 0 8";
/** White's king on a1 is checked by the queen on b2; Kxb2 is the only legal move. */
export const ONE_LEGAL_MOVE = "k7/8/8/8/8/8/1q6/K7 w - - 0 1";
/** White's only pawn move is a7-a8 (any of four pieces); the king and the h-pawn are stuck. */
export const ONLY_PROMOTION = "8/P7/8/8/8/7p/5k1P/7K w - - 0 1";
/** Ne2+ forks White's king and queen: every king move loses the queen. */
export const ROYAL_FORK = "6k1/pp3ppp/8/8/8/2Q5/PP2nPPP/R5K1 w - - 0 30";
/** The knight on c3 is pinned by the bishop on b4 and attacked by the pawn on d4. */
export const PINNED_KNIGHT = "6k1/5ppp/8/8/1b1p4/2N5/PP5P/4K2R w K - 0 30";
/** The bishop on a7 is trapped by the rook on a8 and the pawns on b6 and c7. */
export const TRAPPED_BISHOP = "r5k1/B1p2ppp/1p6/8/8/8/5PPP/6K1 w - - 0 30";
/** The queen on d4 is attacked by the pawn on c5; Qe3 keeps it. */
export const QUEEN_ATTACKED = "3r2k1/5ppp/8/2p5/3Q4/8/5PPP/5RK1 w - - 0 30";

export const cp = (cp: number): MoverEval => ({ kind: "cp", cp });
export const mate = (moverMates: boolean): MoverEval => ({ kind: "mate", moverMates });

/**
 * A move with its before-search lines (`[uci or pv, "cp 30" | "mate 2"]`, mover's view, best
 * first). The played move's own score comes from its line when it has one, else from `reply` (the
 * opponent's view of the position after it).
 */
export function position(
  fen: string,
  playedSan: string,
  lines: readonly (readonly [string, string])[],
  extra: Partial<AssessableMove> & { reply?: string } = {}
): AssessableMove {
  const played = applySan(fen, playedSan);
  if (!played) throw new Error(`illegal ${playedSan}`);
  const { reply, ...rest } = extra;
  const topLines = lines.map(([pv, score], index) =>
    parseLine(`${score} pv ${pv}`, index + 1, fen)
  );
  return {
    ply: 30,
    fenBefore: fen,
    fenAfter: played.fen,
    playedMove: played.uci,
    bestMove: topLines[0]?.pv[0] ?? null,
    topLines,
    replyLines: reply ? [parseLine(reply, 1, played.fen)] : [],
    evalAfter: null,
    motifs: [],
    ...rest
  };
}

/** The same move with a deeper search that agrees with its lines. */
export function verified(move: AssessableMove): AssessableMove {
  return { ...move, verification: { deeperLines: move.topLines } };
}

export function previousWith(
  severity: MoveAssessment["severity"],
  winBefore = 50,
  move?: AssessableMove
) {
  return {
    move: move ?? position(START_FEN, "e4", [["e2e4", "cp 0"]]),
    assessment: {
      policy: 1,
      winBefore,
      winAfter: 20,
      winLoss: 30,
      alternativeGap: null,
      severity,
      annotation: severity,
      tags: []
    }
  };
}

/** A previous move that ends in `fen`, so the context applies. */
export function previousInto(fen: string, severity: MoveAssessment["severity"], winBefore = 50) {
  const context = previousWith(severity, winBefore);
  return { ...context, move: { ...context.move, fenAfter: fen } };
}
