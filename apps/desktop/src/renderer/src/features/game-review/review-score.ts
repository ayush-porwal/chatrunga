import type { EngineScore, MoveReview } from "@chaturanga/shared/types/engine";

/*
 * The renderer's one score-display API:
 * - `formatScore`     an engine score: "+0.4", "-1.2", "M+3", "M-2"; "—" when missing.
 * - `formatMoveEval`  a reviewed move's evaluation after it: the game result for a finished game
 *                     ("1-0 #", "½-½"), otherwise `formatScore(evalAfter)`.
 * (Coach payloads use `formatEngineScore` from shared, a separate wire format.)
 */

/** Chart clamp: ±10 pawns; forced mates sit on the rail. */
export const CHART_SCORE_LIMIT = 1000;

type MoveEvalAfter = Pick<MoveReview, "evalAfter" | "fenBefore" | "terminal">;

/** Side that played the move (side to move in `fenBefore`). */
function moverIsWhite(move: Pick<MoveReview, "fenBefore">): boolean {
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

export function formatScore(score: EngineScore | null | undefined, digits = 1): string {
  if (!score) return "—";
  if (score.type === "mate") return `M${score.value > 0 ? "+" : ""}${score.value}`;
  const pawns = score.value / 100;
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(digits)}`;
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
