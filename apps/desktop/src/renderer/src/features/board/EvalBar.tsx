import { memo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { scoreFromWhitePerspective } from "@chaturanga/shared/chess/review";
import { statusForFen } from "@chaturanga/shared/chess/position";
import type { Color } from "@chaturanga/shared/types/chess";
import type { EngineScore } from "@chaturanga/shared/types/engine";
import { useAnalysisStore } from "../../stores/analysis-store";
import { useGameStore } from "../../stores/game-store";
import { selectLiveGameInProgress, useLichessStore } from "../../stores/lichess-store";
import { usePuzzleStore } from "../../stores/puzzle-store";
import { useDisplayedReviewMoves } from "../../stores/review-validity";
import { formatMoveEval, formatScore } from "../game-review/review-score";
import { cn } from "@/lib/utils";

/** What the bar shows: White's share of it (0–100) and the evaluation as text. */
export type BoardEval = { whiteShare: number; label: string };

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
      matchOn: (state.mode === "engine" || state.mode === "online") && Boolean(state.engineSide) && !state.gameOutcome
    }))
  );
  const onlineGameLive = useLichessStore(selectLiveGameInProgress);
  const liveScore = useAnalysisStore((state) => {
    const primary = state.topLines.find((line) => (line.multipv ?? 1) === 1) ?? state.latestInfo;
    return primary?.score ?? null;
  });
  // A puzzle still being solved: any evaluation would give the answer away.
  const puzzleOpen = usePuzzleStore((state) => Boolean(state.activePuzzle) && state.outcome === "pending");
  const reviewMoves = useDisplayedReviewMoves();
  if (game.matchOn || onlineGameLive || (game.mode === "puzzle" && puzzleOpen)) return null;

  if (game.mode === "analysis") {
    // The game is over on the board: the result, not a score left over from the previous position.
    const status = statusForFen(game.fen);
    if (status.isEnd) {
      const whiteShare = status.result === "1-0" ? 100 : status.result === "0-1" ? 0 : 50;
      return { whiteShare, label: status.isCheckmate ? `${status.result} #` : "½-½" };
    }
    if (!liveScore) return null;
    const white = scoreFromWhitePerspective(liveScore, statusForFen(game.fen).turn);
    return { whiteShare: evalShare(white), label: formatScore(white) };
  }

  if (!reviewMoves.length) return null;
  const move = reviewMoves.find((item) => item.nodeId === game.nodeId);
  if (move?.evalAfter) {
    const mate = move.terminal === "checkmate" || (move.evalAfter.type === "mate" && move.evalAfter.value === 0);
    const whiteMoved = move.fenBefore.split(" ")[1] !== "b";
    const whiteShare = mate ? (whiteMoved ? 100 : 0) : evalShare(move.evalAfter);
    return { whiteShare, label: formatMoveEval(move) };
  }
  // The starting position: the first reviewed move's evaluation before it.
  const first = reviewMoves[0];
  if (game.nodeId === "root" && first?.evalBefore) {
    return { whiteShare: evalShare(first.evalBefore), label: formatScore(first.evalBefore) };
  }
  return null;
}

/**
 * The vertical eval bar beside the board: White's share grows from White's side of the board.
 * Keeps its last value while a new search starts, so it glides instead of blinking.
 */
export const EvalBar = memo(function EvalBar({ orientation }: { orientation: Color }) {
  const current = useBoardEval();
  const searching = useAnalysisStore((state) => state.status === "thinking");
  const mode = useGameStore((state) => state.mode);
  // The last evaluation shown, held through the moment a new search has no score yet.
  const [held, setHeld] = useState<BoardEval | null>(current);
  if (current && (current.whiteShare !== held?.whiteShare || current.label !== held.label)) setHeld(current);
  else if (!current && held && !(mode === "analysis" && searching)) setHeld(null);
  const shown = current ?? held;
  if (!shown) return null;
  const whiteAtBottom = orientation === "white";
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
    </div>
  );
});
