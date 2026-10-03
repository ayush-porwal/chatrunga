import type { PuzzleInsightPayload } from "@chaturanga/shared/schemas/puzzle-insight";
import type { CommentaryMoveToken } from "../game-review/commentary-moves";

/**
 * Which solution move a SAN token in a puzzle explanation names, so it can link there. A token
 * links only when it names exactly one solution ply: the same SAN can recur in a solution
 * ("Rxe1" then "Rxe1#") or stand for another move the coach was told about (the wrong move, its
 * refutation, an alternative), and a link to a guessed ply would show the wrong position.
 */

/** The solution and the other moves an explanation may mention. */
export type PuzzleProseLine = {
  /** The puzzle's start position (its move number places the solution's plies). */
  fen: string;
  solutionSan: readonly string[];
  /** SAN of the moves that aren't the solution's, from the explanation's facts. */
  otherSan: readonly string[];
};

const plain = (san: string) => san.replace(/[+#]+$/, "");

/** The 1-based ply of the start position's move ("14." → 27, "14..." → 28), like a token's hint. */
function firstPly(fen: string): number {
  const [, turn = "w", , , , fullmove = "1"] = fen.split(" ");
  return ((Number(fullmove) || 1) - 1) * 2 + (turn === "b" ? 1 : 0) + 1;
}

/**
 * The solution index `token` names, or null. A move-number prefix ("24...Rxe1") narrows it to that
 * ply. An exact SAN (with its +/#) is preferred; otherwise the SAN without +/# must still name a
 * single move. A token that matches another known move as closely as a solution move is ambiguous.
 */
export function solutionIndexForToken(token: Pick<CommentaryMoveToken, "san" | "plyHint">, line: PuzzleProseLine): number | null {
  const start = firstPly(line.fen);
  const plies = line.solutionSan
    .map((san, index) => ({ san, index }))
    .filter(({ index }) => token.plyHint === null || token.plyHint === start + index);
  for (const same of [(san: string) => san === token.san, (san: string) => plain(san) === plain(token.san)]) {
    const matches = plies.filter(({ san }) => same(san));
    const other = line.otherSan.some(same);
    if (matches.length === 1 && !other) return matches[0]!.index;
    if (matches.length || other) return null;
  }
  return null;
}

/** The moves of an explanation's facts that aren't the solution's (see {@link PuzzleProseLine}). */
export function nonSolutionSan(payload: PuzzleInsightPayload): string[] {
  const { mistake, engine } = payload;
  const other = (engine.alternatives ?? []).flatMap((alternative) => alternative.lineSan);
  if (mistake) other.push(mistake.san, ...mistake.refutationSan);
  return [...new Set(other)];
}
