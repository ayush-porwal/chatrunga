import type { Color, GameHeaders, GameMode } from "@chaturanga/shared/types/chess";
import { positionStatus } from "@/lib/position-status";
import { isMatchMode } from "../../stores/game-store";

/*
 * After a match: whether an engine game is over, whose win it was, and the result a game decided
 * on the board still lacks in its headers. Pure (no store reads), so the titlebar's post-game row,
 * the board's celebration and App's Review game agree on one definition.
 */

/**
 * An engine game is over: a result decided this session (resignation, flag, agreement) or a
 * finished position (mate, stalemate, a draw by rule) at the end of its main line (`endFen`),
 * wherever the cursor is.
 */
export function engineGameEnded(game: {
  mode: GameMode;
  engineSide: Color | null;
  gameOutcome: unknown;
  endFen: string;
}): boolean {
  return (
    game.mode === "engine" &&
    Boolean(game.engineSide) &&
    (Boolean(game.gameOutcome) || positionStatus(game.endFen).isEnd)
  );
}

/** The side the user plays in a match (the app moves the other one), or null outside a match. */
export function userSide(mode: GameMode, engineSide: Color | null): Color | null {
  if (!isMatchMode(mode) || !engineSide) return null;
  return engineSide === "white" ? "black" : "white";
}

/** Whether `result` ("1-0", "0-1", …) is a win for the user in an engine or Lichess game. */
export function userWon(
  result: string | null | undefined,
  mode: GameMode,
  engineSide: Color | null
): boolean {
  const user = userSide(mode, engineSide);
  if (!user) return false;
  return (result === "1-0" && user === "white") || (result === "0-1" && user === "black");
}

/**
 * The result a game that ended on the board (mate, stalemate, a draw by rule) doesn't have in its
 * headers yet, so Game review shows it like a resignation's; null when there's nothing to add.
 */
export function boardResultPatch(game: {
  gameOutcome: unknown;
  headers: Pick<GameHeaders, "result">;
  endFen: string;
}): Pick<GameHeaders, "result"> | null {
  if (game.gameOutcome) return null;
  const end = positionStatus(game.endFen);
  if (!end.isEnd || end.result === "*") return null;
  const recorded = game.headers.result?.trim();
  return recorded && recorded !== "*" ? null : { result: end.result };
}
