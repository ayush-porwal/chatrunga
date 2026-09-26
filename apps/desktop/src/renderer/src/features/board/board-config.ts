import type { Config } from "@lichess-org/chessground/config";
import type { Key } from "@lichess-org/chessground/types";
import { legalDestsForFen, statusForFen } from "@chaturanga/shared/chess/position";
import type { Color } from "@chaturanga/shared/types/chess";
import { PIECE_MOVE_MS } from "./board-motion";

/**
 * Chessground config that puts the board back on `fen` after a move the app rejected (a wrong
 * puzzle move). Chessground has already played the move on its own state — flipping the turn and
 * clearing the legal moves — so the restore must hand back the side to move *and* its legal
 * destinations, or the next (correct) move cannot be made.
 */
export function restoreBoardConfig({
  fen,
  orientation,
  lastMove,
  movableColor,
  showDests,
  animate
}: {
  fen: string;
  orientation: Color;
  lastMove: Key[] | undefined;
  movableColor: Color | undefined;
  showDests: boolean;
  animate: boolean;
}): Config {
  const status = statusForFen(fen);
  return {
    fen,
    orientation,
    turnColor: status.turn,
    check: status.isCheck,
    lastMove,
    // Slides the rejected piece back to where it came from.
    animation: { enabled: animate, duration: PIECE_MOVE_MS },
    movable: {
      color: movableColor,
      dests: legalDestsForFen(fen),
      showDests,
      free: false,
      rookCastle: true
    }
  };
}
