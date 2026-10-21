import { winPercent } from "@chaturanga/shared/chess/move-assessment";
import type { EngineScore, MoveReview } from "@chaturanga/shared/types/engine";

/*
 * The renderer's one score-display API:
 * - `formatScore`     an engine score: "+0.4", "-1.2", "M+3", "M-2"; "—" when missing.
 * - `formatMoveEval`  a reviewed move's evaluation after it: the game result for a finished game
 *                     ("1-0 #", "½-½"), otherwise `formatScore(evalAfter)`.
 * - `whiteWinBefore` / `whiteWinAfter` / `moverWinChances`  winning chances (Lichess WinPercent) of
 *                     a reviewed move's evaluations: what the charts plot and the Engine tab's
 *                     chances tile shows, so the two always agree.
 * (Coach payloads use `formatEngineScore` from shared, a separate wire format.)
 */

/** Chart clamp: ±10 pawns; forced mates sit on the rail. */
const CHART_SCORE_LIMIT = 1000;

type MoveEvalAfter = Pick<MoveReview, "evalAfter" | "fenBefore" | "terminal">;

/** Side that played the move (side to move in `fenBefore`). */
export function moverIsWhite(move: Pick<MoveReview, "fenBefore">): boolean {
  return move.fenBefore.split(" ")[1] !== "b";
}

/**
 * White-perspective graph value of `evalAfter`, clamped to ±{@link CHART_SCORE_LIMIT}.
 * `evalAfter` is White-perspective except a checkmate, which main stores as `mate 0`
 * ("side to move is mated") — that is a win for the mover, whatever colour they are.
 */
export function whiteChartScore(move: MoveEvalAfter): number {
  const score = move.evalAfter;
  if (!score) return 0;
  if (move.terminal === "checkmate" || (score.type === "mate" && score.value === 0)) {
    return moverIsWhite(move) ? CHART_SCORE_LIMIT : -CHART_SCORE_LIMIT;
  }
  if (score.type === "mate") return score.value > 0 ? CHART_SCORE_LIMIT : -CHART_SCORE_LIMIT;
  return Math.max(-CHART_SCORE_LIMIT, Math.min(CHART_SCORE_LIMIT, score.value));
}

/** White's winning chances (0–100) after a move: a checkmate is decided, a mate to come the ceiling. */
export function whiteWinAfter(move: MoveEvalAfter): number {
  if (
    move.terminal === "checkmate" ||
    (move.evalAfter?.type === "mate" && move.evalAfter.value === 0)
  )
    return moverIsWhite(move) ? 100 : 0;
  return winPercent(whiteChartScore(move));
}

/** White's winning chances (0–100) before a move, from its `evalBefore`; null without one. */
export function whiteWinBefore(move: Pick<MoveReview, "evalBefore">): number | null {
  const score = move.evalBefore;
  if (!score) return null;
  if (score.type === "mate")
    return winPercent(score.value >= 0 ? CHART_SCORE_LIMIT : -CHART_SCORE_LIMIT);
  return winPercent(score.value);
}

/**
 * The mover's winning chances before and after a move, in whole percents, from the evaluations of
 * the positions either side of it (as the charts plot them); null without them.
 */
export function moverWinChances(
  move: MoveEvalAfter & Pick<MoveReview, "evalBefore">
): { before: number; after: number } | null {
  const before = whiteWinBefore(move);
  // A finished game is decided by its result, evaluated or not.
  if (before === null || (!move.evalAfter && !move.terminal)) return null;
  const after = whiteWinAfter(move);
  const mover = (white: number) => Math.round(moverIsWhite(move) ? white : 100 - white);
  return { before: mover(before), after: mover(after) };
}

export function formatScore(score: EngineScore | null | undefined, digits = 1): string {
  if (!score) return "—";
  if (score.type === "mate") return `M${score.value > 0 ? "+" : ""}${score.value}`;
  const pawns = score.value / 100;
  const shown = pawns.toFixed(digits);
  // A score that rounds to nothing is level: "0.0", never "+0.0" or "-0.0".
  if (Number(shown) === 0) return (0).toFixed(digits);
  return `${pawns > 0 ? "+" : ""}${shown}`;
}

export function formatMoveEval(move: MoveEvalAfter): string {
  return terminalEvalLabel(move) ?? formatScore(move.evalAfter);
}

/**
 * Game-over label for a terminal `evalAfter` ("1-0 #", "0-1 #", "½-½"), or null when the game
 * goes on. Use in place of the raw `M0` / `+0.0` that the synthesized score would print.
 */
export function terminalEvalLabel(move: MoveEvalAfter): string | null {
  if (
    move.terminal === "checkmate" ||
    (move.evalAfter?.type === "mate" && move.evalAfter.value === 0)
  ) {
    return moverIsWhite(move) ? "1-0 #" : "0-1 #";
  }
  if (move.terminal === "stalemate" || move.terminal === "draw") return "½-½";
  return null;
}
