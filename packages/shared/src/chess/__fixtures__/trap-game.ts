/**
 * Test fixture: the Blackburne Shilling trap (1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7
 * Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3#) as a review would store it, from the same scripted lines the
 * desktop's fake engine plays in its "review" mode (apps/desktop/src/main/engine/__fixtures__).
 */
import type { AnalysisLine, EngineScore, MoveReview } from "../../types/engine";
import { applySan, START_FEN } from "../position";
import { scoreFromWhitePerspective } from "../review";

export const TRAP_SANS = [
  "e4",
  "e5",
  "Nf3",
  "Nc6",
  "Bc4",
  "Nd4",
  "Nxe5",
  "Qg5",
  "Nxf7",
  "Qxg2",
  "Rf1",
  "Qxe4+",
  "Be2",
  "Nf3#"
];

/** MultiPV lines of the position before each ply (side-to-move scores), as `score … pv …`. */
export const TRAP_LINES: readonly (readonly string[])[] = [
  ["cp 30 pv e2e4 e7e5", "cp 25 pv d2d4 d7d5", "cp 20 pv g1f3 d7d5"],
  ["cp -30 pv e7e5 g1f3", "cp -35 pv c7c5 g1f3", "cp -40 pv e7e6 d2d4"],
  ["cp 35 pv g1f3 b8c6", "cp 30 pv f1c4 g8f6", "cp 25 pv b1c3 g8f6"],
  ["cp -35 pv b8c6 f1b5", "cp -40 pv g8f6 f3e5", "cp -45 pv d7d6 d2d4"],
  ["cp 40 pv f1b5 a7a6", "cp 30 pv f1c4 f8c5", "cp 30 pv d2d4 e5d4"],
  ["cp -20 pv g8f6 d2d3", "cp -30 pv f8c5 c2c3", "cp -120 pv c6d4 f3d4"],
  ["cp 120 pv f3d4 e5d4", "cp 100 pv c2c3 d4f3", "cp 80 pv e1g1 g8f6"],
  ["cp 250 pv d8g5 e5f7 g5g2", "cp 40 pv d8e7 e5f3", "cp 0 pv d4c2 e1f1"],
  ["cp -120 pv c4f7 e8e7", "cp -160 pv e5g4 d7d5", "cp -200 pv d2d4 g5g2"],
  ["cp 500 pv g5g2 h1f1 g2e4", "cp 430 pv d4c2 e1f1", "cp 300 pv g8f6 f7h8"],
  ["cp -500 pv h1f1 g2e4", "cp -550 pv d1f3 d4f3", "cp -900 pv f7h8 g2h1"],
  ["mate 2 pv g2e4 c4e2 d4f3", "cp 400 pv d4f3 d1f3"],
  ["cp -800 pv d1e2 e4e2", "mate -1 pv c4e2 d4f3"],
  ["mate 1 pv d4f3"]
];

/** The engine's best-move motifs as main computes them, by ply. */
const TRAP_MOTIFS: Record<number, string[]> = {
  10: ["hanging"],
  12: ["forced mate", "hanging"],
  14: ["checkmate"]
};

/** One MultiPV line from `score cp 30 pv e2e4 e7e5` text, searched in `fen`. */
export function parseLine(text: string, multipv: number, fen: string): AnalysisLine {
  const [scoreText = "", pvText = ""] = text.split(" pv ");
  const [type, value] = scoreText.split(" ");
  const score: EngineScore = { type: type === "mate" ? "mate" : "cp", value: Number(value) };
  const turn = fen.split(" ")[1] === "b" ? "black" : "white";
  return {
    multipv,
    depth: 12,
    score,
    scoreWhite: scoreFromWhitePerspective(score, turn),
    pv: pvText.split(" ").filter(Boolean)
  };
}

/**
 * The trap game's moves as a schema-2 review stored them (no assessments yet): the lines of each
 * position, the next position's lines as the reply, the played move's rank when it was a line.
 */
export function trapReviewMoves(lines: readonly (readonly string[])[] = TRAP_LINES): MoveReview[] {
  let fen = START_FEN;
  return TRAP_SANS.map((san, index) => {
    const played = applySan(fen, san);
    if (!played) throw new Error(`illegal ${san}`);
    const topLines = (lines[index] ?? []).map((text, line) => parseLine(text, line + 1, fen));
    const replyLines = (lines[index + 1] ?? []).map((text, line) =>
      parseLine(text, line + 1, played.fen)
    );
    const playedLine = topLines.find((line) => line.pv[0] === played.uci) ?? null;
    const move: MoveReview = {
      nodeId: `n${index + 1}`,
      ply: index + 1,
      san: played.san,
      playedMove: played.uci,
      fenBefore: fen,
      fenAfter: played.fen,
      evalBefore: topLines[0]?.scoreWhite ?? null,
      evalAfter: replyLines[0]?.scoreWhite ?? null,
      evalLoss: null,
      bestMove: topLines[0]?.pv[0] ?? null,
      bestLine: topLines[0]?.pv ?? [],
      topLines,
      replyLines: index === TRAP_SANS.length - 1 ? [] : replyLines,
      playedRank: playedLine?.multipv ?? null,
      terminal: index === TRAP_SANS.length - 1 ? "checkmate" : null,
      motifs: TRAP_MOTIFS[index + 1] ?? []
    };
    fen = played.fen;
    return move;
  });
}
