import { engineDisplayName } from "@chaturanga/shared/engine/managed";
import type { Color } from "@chaturanga/shared/types/chess";
import type { useGameStore } from "../stores/game-store";

type GameState = ReturnType<typeof useGameStore.getState>;

/** The PGN result when the game is decided ("*" means still in progress). */
export function decidedResult(result: string | null | undefined): string | null {
  return result && result !== "*" ? result : null;
}

/** The store's and the PGN's termination strings in the words the result badge uses. */
const TERMINATION_LABELS: Record<string, string> = {
  "player resign": "Resignation",
  "time forfeit": "On time",
  "draw by agreement": "Agreement"
};

/**
 * Terminations that don't say how the game ended (Lichess writes "Normal" for mate, resignation
 * and agreed draws alike): the badge shows the result alone.
 */
const UNINFORMATIVE_TERMINATIONS = new Set(["normal", "unterminated"]);

/**
 * The titlebar's result badge: the result with how the game ended ("1-0 · Resignation"), the
 * result alone when that isn't known; null for an undecided game.
 */
export function resultBadgeLabel(
  result: string | null | undefined,
  termination: string | null | undefined
): string | null {
  const decided = decidedResult(result);
  if (!decided) return null;
  const how = terminationReason(termination?.trim() ?? "");
  if (!how || UNINFORMATIVE_TERMINATIONS.has(how.toLowerCase())) return decided;
  const label = TERMINATION_LABELS[how.toLowerCase()] ?? how[0]!.toUpperCase() + how.slice(1);
  return `${decided} · ${label}`;
}

/** Chess.com's sentence: "{player} won by checkmate", "… won on time", "Game drawn by repetition". */
const RESULT_SENTENCE = /\b(?:won|drawn)\b(?:\s+(by|on)\s+(.+))?$/i;

/**
 * Just how the game ended, from a termination that may be a whole sentence: Chess.com's names the
 * winner and restates the result ("pawnstorm99 won by checkmate" → "checkmate", "… won on time" →
 * "on time"); a sentence without the reason gives "".
 */
function terminationReason(termination: string): string {
  const sentence = RESULT_SENTENCE.exec(termination);
  if (!sentence) return termination;
  const [, preposition, reason] = sentence;
  if (!reason) return "";
  return preposition?.toLowerCase() === "on" ? `on ${reason}` : reason;
}

export function gameModeLabel(
  game: Pick<GameState, "mode" | "source"> & Partial<Pick<GameState, "analysisBoard">>
): string {
  if (game.mode === "online" || game.source === "lichess") return "Lichess game";
  if (game.source === "chesscom") return "Chess.com game";
  if (game.mode === "engine" || game.source === "engine-game") return "Engine game";
  if (game.mode === "puzzle" || game.source === "puzzle") return "Puzzle";
  // Where a game came from names it, whatever the board does with it; "Analysis" is for one
  // made on the Analyze board.
  if (game.source === "pgn-import") return "Imported game";
  if (game.mode === "analysis" || game.analysisBoard || game.source === "analysis")
    return "Analysis";
  return "Free board";
}

/**
 * Player names for the titlebar. In an engine game the engine's side shows the engine's name and
 * an unnamed human side shows "You". Engines show their plain name ("Stockfish", also for a name
 * saved by an older build as "Stockfish (managed)"). Null while both sides are unnamed.
 */
export function gamePlayerNames(
  game: Pick<GameState, "headers" | "mode" | "engineSide">,
  engineName: string | null
): { white: string; black: string } | null {
  const nameFor = (color: Color) => {
    const fallback = color === "white" ? "White" : "Black";
    const name = engineDisplayName(game.headers[color]?.trim() ?? "") || fallback;
    if (game.mode !== "engine" || !game.engineSide) return name;
    if (game.engineSide === color) return engineName ? engineDisplayName(engineName) : name;
    return name === fallback ? "You" : name;
  };
  const white = nameFor("white");
  const black = nameFor("black");
  return white === "White" && black === "Black" ? null : { white, black };
}
