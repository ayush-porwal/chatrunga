import { memo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { scoreFromWhitePerspective } from "@chaturanga/shared/chess/review";
import { statusForFen } from "@chaturanga/shared/chess/position";
import type { Color } from "@chaturanga/shared/types/chess";
import type { EngineScore, MoveReview } from "@chaturanga/shared/types/engine";
import { useAnalysisStore } from "../../stores/analysis-store";
import { useGameStore } from "../../stores/game-store";
import { selectLiveGameInProgress, useLichessStore } from "../../stores/lichess-store";
import { usePuzzleStore } from "../../stores/puzzle-store";
import { useDisplayedReviewMoves } from "../../stores/review-validity";
import {
  formatMoveEval,
  formatScore,
  moverIsWhite,
  terminalEvalLabel
} from "../game-review/review-score";
import { cn } from "@/lib/utils";

/**
 * What the bar shows: White's share of it (0–100), the evaluation as text (signed, for its
 * accessible name and tooltip), the short text drawn inside the bar (see barScoreText) and the
 * side whose end that text sits at (see barScoreSide).
 */
export type BoardEval = { whiteShare: number; label: string; barText: string; barSide: Color };

/**
 * White's share of the bar for a White-perspective score: Lichess's winning-chances curve, so a
 * pawn up reads as an edge and ±10 pawns as nearly decided. A forced mate fills the bar.
 */
export function evalShare(score: EngineScore): number {
  if (score.type === "mate") return score.value > 0 ? 100 : score.value < 0 ? 0 : 50;
  const chances = 2 / (1 + Math.exp(-0.00368208 * score.value)) - 1;
  return 50 + 50 * chances;
}

/**
 * The text inside the bar for a White-perspective score, as Lichess and chess.com print it: the
 * size of the edge without a sign, since the end of the bar it sits at says whose it is ("0.4",
 * "4.5", "M3"). From ten pawns up it drops the decimal ("12"), so it still fits the bar's width.
 */
export function barScoreText(score: EngineScore): string {
  if (score.type === "mate") return `M${Math.abs(score.value)}`;
  const pawns = barPawns(score.value);
  return pawns >= 10 ? String(Math.round(pawns)) : pawns.toFixed(1);
}

/** The size of a centipawn edge in pawns, rounded to the tenth the bar prints. */
function barPawns(centipawns: number): number {
  return Math.round(Math.abs(centipawns) / 10) / 10;
}

/**
 * The side whose end of the bar a White-perspective score's text sits at: the better side, and
 * White on a score that prints "0.0" (a few centipawns either way), as on an exact 0. So the same
 * text never sits at two ends.
 */
export function barScoreSide(score: EngineScore): Color {
  const blackBetter =
    score.type === "mate" ? score.value < 0 : score.value < 0 && barPawns(score.value) > 0;
  return blackBetter ? "black" : "white";
}

/** The bar's evaluation of a White-perspective score. */
export function scoreEval(score: EngineScore): BoardEval {
  return {
    whiteShare: evalShare(score),
    label: formatScore(score),
    barText: barScoreText(score),
    barSide: barScoreSide(score)
  };
}

/**
 * Where the bar's text goes: at its side's end (the better side's, White's on an even score),
 * which is White's end at the bottom unless the board is flipped. `side` is returned so the text
 * can take the colour that reads on its fill.
 */
export function evalBarLabel(
  evaluation: Pick<BoardEval, "barText" | "barSide">,
  orientation: Color
): { text: string; side: Color; atTop: boolean } {
  const side = evaluation.barSide;
  return { text: evaluation.barText, side, atTop: side !== orientation };
}

/**
 * Live analysis's evaluation of `fen` from its principal line's `score` (from the side to move, as
 * UCI reports it). A finished position shows its result, not a score left over from the previous
 * position. Null while there is no score yet.
 */
export function liveAnalysisEval(fen: string, score: EngineScore | null): BoardEval | null {
  const status = statusForFen(fen);
  if (status.isEnd) {
    const whiteShare = status.result === "1-0" ? 100 : status.result === "0-1" ? 0 : 50;
    const draw = !status.isCheckmate;
    return {
      whiteShare,
      label: draw ? "½-½" : `${status.result} #`,
      barText: draw ? "½-½" : status.result,
      barSide: status.result === "0-1" ? "black" : "white"
    };
  }
  if (!score) return null;
  return scoreEval(scoreFromWhitePerspective(score, status.turn));
}

/** The principal line's score of the live analysis (the latest info's before any line arrives). */
export function useLiveAnalysisScore(): EngineScore | null {
  return useAnalysisStore((state) => {
    const primary = state.topLines.find((line) => (line.multipv ?? 1) === 1) ?? state.latestInfo;
    return primary?.score ?? null;
  });
}

/**
 * The evaluation for the position on the board: live analysis while the engine runs, else the
 * game review's evaluation of this move. Null when there is none, and always during a match that
 * is still being played (an engine game or a live Lichess game) or a puzzle not yet solved or failed.
 */
export function useBoardEval(): BoardEval | null {
  const game = useGameStore(
    useShallow((state) => ({
      mode: state.mode,
      fen: state.currentFen,
      nodeId: state.currentNodeId,
      matchOn:
        (state.mode === "engine" || state.mode === "online") &&
        Boolean(state.engineSide) &&
        !state.gameOutcome
    }))
  );
  const onlineGameLive = useLichessStore(selectLiveGameInProgress);
  const liveScore = useLiveAnalysisScore();
  // A puzzle still being solved: any evaluation would give the answer away.
  const puzzleOpen = usePuzzleStore(
    (state) => Boolean(state.activePuzzle) && state.outcome === "pending"
  );
  const reviewMoves = useDisplayedReviewMoves();
  if (game.matchOn || onlineGameLive || (game.mode === "puzzle" && puzzleOpen)) return null;

  if (game.mode === "analysis") return liveAnalysisEval(game.fen, liveScore);

  if (!reviewMoves.length) return null;
  const move = reviewMoves.find((item) => item.nodeId === game.nodeId);
  const evaluation = move ? reviewedMoveEval(move) : null;
  if (evaluation) return evaluation;
  // The starting position: the first reviewed move's evaluation before it.
  const first = reviewMoves[0];
  if (game.nodeId === "root" && first?.evalBefore) return scoreEval(first.evalBefore);
  return null;
}

/**
 * A reviewed move's evaluation after it (White's perspective; null when it has none). A move that
 * ends the game shows the result: a checkmate fills the bar for the side that gave it (main stores
 * it as `mate 0`, the side to move is mated), a draw sits at even.
 */
export function reviewedMoveEval(
  move: Pick<MoveReview, "evalAfter" | "fenBefore" | "terminal">
): BoardEval | null {
  if (!move.evalAfter) return null;
  const result = terminalEvalLabel(move);
  if (!result) return scoreEval(move.evalAfter);
  if (result === "½-½") return { whiteShare: 50, label: result, barText: result, barSide: "white" };
  const whiteMoved = moverIsWhite(move);
  return {
    whiteShare: whiteMoved ? 100 : 0,
    label: formatMoveEval(move),
    barText: whiteMoved ? "1-0" : "0-1",
    barSide: whiteMoved ? "white" : "black"
  };
}

/** The game board's eval bar (see useBoardEval). */
export const EvalBar = memo(function EvalBar({ orientation }: { orientation: Color }) {
  const current = useBoardEval();
  const live = useGameStore((state) => state.mode === "analysis");
  return <EvalBarFill orientation={orientation} evaluation={current} live={live} />;
});

/**
 * The vertical eval bar beside a board: White's share grows from White's side of the board, and
 * the evaluation is printed at the better side's end (evalBarLabel), dark on the white fill and
 * light on the black. With `live` analysis it keeps its last value while a new search starts, so
 * it glides instead of blinking.
 */
export function EvalBarFill({
  orientation,
  evaluation: current,
  live
}: {
  orientation: Color;
  evaluation: BoardEval | null;
  /** The evaluation comes from live analysis (held through a new search's first moments). */
  live: boolean;
}) {
  const searching = useAnalysisStore((state) => state.status === "thinking");
  // The last evaluation shown, held through the moment a new search has no score yet.
  const [held, setHeld] = useState<BoardEval | null>(current);
  if (
    current &&
    (current.whiteShare !== held?.whiteShare ||
      current.label !== held.label ||
      current.barText !== held.barText ||
      current.barSide !== held.barSide)
  )
    setHeld(current);
  else if (!current && held && !(live && searching)) setHeld(null);
  const shown = current ?? held;
  if (!shown) return null;
  const whiteAtBottom = orientation === "white";
  const text = evalBarLabel(shown, orientation);
  return (
    <div
      role="img"
      aria-label={`Evaluation ${shown.label}`}
      title={shown.label}
      className="relative h-full w-full overflow-hidden rounded-md border border-line bg-black animate-fade-in"
    >
      <div
        className={cn(
          "absolute inset-x-0 bg-white transition-[height] duration-emphasis ease-standard motion-reduce:transition-none",
          whiteAtBottom ? "bottom-0" : "top-0"
        )}
        style={{ height: `${shown.whiteShare}%` }}
      />
      {/* The even line, so a small edge still reads against it. */}
      <div aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-accent/60" />
      {/* Positioned over the fill (never in the flow), so a longer number never moves anything. */}
      <span
        aria-hidden="true"
        data-eval-side={text.side}
        className={cn(
          "absolute inset-x-0 overflow-hidden text-center text-[0.625rem] font-semibold leading-none tracking-tighter tabular-nums whitespace-nowrap select-none",
          text.atTop ? "top-1" : "bottom-1",
          text.side === "white" ? "text-piece-black" : "text-piece-white"
        )}
      >
        {text.text}
      </span>
    </div>
  );
}
