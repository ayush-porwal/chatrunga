import { useEffect } from "react";
import { applyUserMove } from "@chaturanga/shared/chess/position";
import { userMoveFromUci } from "@/lib/uci";
import { useGameStore } from "../../stores/game-store";
import { usePuzzleStore } from "../../stores/puzzle-store";

/** Delay before the puzzle plays the opponent's reply, so the user sees their own move land. */
export const PUZZLE_REPLY_DELAY_MS = 320;

/** Moves the active puzzle one solution move forward, completing it after the last one. */
function advancePuzzle(feedback: string): void {
  const store = usePuzzleStore.getState();
  if (!store.activePuzzle) return;
  if (store.solutionIndex + 1 >= store.activePuzzle.solutionMoves.length) store.markComplete();
  else store.advanceSolution(1, feedback);
}

/**
 * Checks the user's move (UCI) against the active puzzle's next solution move. The expected move
 * is played through `play` and the puzzle advances; anything else is marked wrong and not played.
 * Returns whether the move was played (callers restore the board otherwise). `fenBefore` (default:
 * the board's position) names the wrong move in SAN in the feedback.
 */
export function submitPuzzleMove(uci: string, play: () => boolean, fenBefore = useGameStore.getState().currentFen): boolean {
  const { activePuzzle, solutionIndex, markWrongMove } = usePuzzleStore.getState();
  const expected = activePuzzle?.solutionMoves[solutionIndex];
  if (!expected) return false;
  if (uci !== expected) {
    markWrongMove({ played: sanOf(fenBefore, uci), expected });
    return false;
  }
  if (!play()) return false;
  advancePuzzle("Correct. Continue the line.");
  return true;
}

function sanOf(fen: string, uci: string): string {
  try {
    const move = userMoveFromUci(uci);
    return (move && applyUserMove(fen, move)?.san) || uci;
  } catch {
    return uci;
  }
}

/**
 * After each correct user move (odd solution index), plays the opponent's scripted reply.
 * Mounted once by the app shell while a puzzle is active.
 */
export function usePuzzleAutoReply(): void {
  const mode = useGameStore((state) => state.mode);
  const activePuzzle = usePuzzleStore((state) => state.activePuzzle);
  const solutionIndex = usePuzzleStore((state) => state.solutionIndex);

  useEffect(() => {
    if (mode !== "puzzle" || !activePuzzle) return;
    if (solutionIndex % 2 === 0 || solutionIndex >= activePuzzle.solutionMoves.length) return;
    const reply = activePuzzle.solutionMoves[solutionIndex];
    const timeout = window.setTimeout(() => {
      if (!useGameStore.getState().makeUciMove(reply)) {
        usePuzzleStore.getState().markWrongMove({ played: "Auto reply failed", expected: reply });
        return;
      }
      advancePuzzle("Good. Find the next move.");
    }, PUZZLE_REPLY_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [activePuzzle, mode, solutionIndex]);
}
