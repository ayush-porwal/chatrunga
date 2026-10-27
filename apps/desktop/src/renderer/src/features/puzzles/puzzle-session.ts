import { useEffect } from "react";
import { applyUserMove } from "@chaturanga/shared/chess/position";
import { userMoveFromUci } from "@/lib/uci";
import { playSound } from "../../sounds/sounds";
import { useGameStore } from "../../stores/game-store";
import { usePuzzleStore } from "../../stores/puzzle-store";
import { GAME_PUZZLES_SET_ID } from "./game-puzzle-set";

/** Delay before the puzzle plays the opponent's reply, so the user sees their own move land. */
const PUZZLE_REPLY_DELAY_MS = 320;

/** Moves the active puzzle one solution move forward, completing it after the last one. */
function advancePuzzle(feedback: string): void {
  const store = usePuzzleStore.getState();
  if (!store.activePuzzle) return;
  if (store.solutionIndex + 1 >= store.activePuzzle.solutionMoves.length) completePuzzle();
  else store.advanceSolution(1, feedback);
}

function completePuzzle(): void {
  usePuzzleStore.getState().markComplete();
  // A puzzle finished after a wrong move or a shown solution is complete, not solved.
  const { feedbackKind, outcome } = usePuzzleStore.getState();
  if (feedbackKind === "complete" && outcome !== "failed") playSound("correct");
}

/**
 * Checks the user's move (UCI) against the active puzzle's next solution move. The expected move
 * is played through `play` and the puzzle advances; anything else is marked wrong and not played.
 * In the "From my games" set, whose generator accepts a mate with another mate beside it, any
 * mate where the solution mates is right too: it is played and ends the line.
 * Returns whether the move was played (callers restore the board otherwise). `fenBefore` (default:
 * the board's position) is where the move was played from: a wrong move is recorded with it, and
 * named in SAN in the feedback.
 */
export function submitPuzzleMove(
  uci: string,
  play: () => boolean,
  fenBefore = useGameStore.getState().currentFen
): boolean {
  const { activePuzzle, solutionIndex, markWrongMove, feedbackKind } = usePuzzleStore.getState();
  const expected = activePuzzle?.solutionMoves[solutionIndex];
  // A broken puzzle has ended: no move is checked against it any more.
  if (!expected || feedbackKind === "broken") return false;
  const san = sanOf(fenBefore, uci);
  const otherMate =
    uci !== expected &&
    activePuzzle.sourceId === GAME_PUZZLES_SET_ID &&
    isMate(san) &&
    isMate(sanOf(fenBefore, expected));
  if (uci !== expected && !otherMate) {
    markWrongMove({ uci, san, fen: fenBefore, expected });
    playSound("error");
    return false;
  }
  if (!play()) return false;
  if (otherMate) completePuzzle();
  else advancePuzzle("Correct. Continue the line.");
  return true;
}

const isMate = (san: string) => san.endsWith("#");

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
        usePuzzleStore.getState().markReplyFailed();
        return;
      }
      advancePuzzle("Good. Find the next move.");
    }, PUZZLE_REPLY_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [activePuzzle, mode, solutionIndex]);
}
