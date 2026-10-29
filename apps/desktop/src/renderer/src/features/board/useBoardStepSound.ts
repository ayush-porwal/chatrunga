import { useEffect, useRef } from "react";
import { playMoveSound } from "../../sounds/sounds";
import { sanOfStep } from "../../sounds/sound-events";

/**
 * Plays a move's sound when a board that owns its position (`fen`, with `lastMove` the move into
 * it) steps one move forward, the way the main board does: a move played on it, an opponent's
 * reply, a step through a line. A step back, a jump or a new position plays nothing; nor does
 * anything while `enabled` is off (the steps are still followed).
 */
export function useBoardStepSound(
  fen: string,
  lastMove: readonly [string, string] | null,
  enabled = true
): void {
  const shown = useRef(fen);
  useEffect(() => {
    const before = shown.current;
    shown.current = fen;
    const san = enabled ? sanOfStep(before, fen, lastMove) : null;
    if (san) playMoveSound(san);
  }, [enabled, fen, lastMove]);
}
