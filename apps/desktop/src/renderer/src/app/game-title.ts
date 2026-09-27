import type { Color } from "@chaturanga/shared/types/chess";
import type { useGameStore } from "../stores/game-store";

type GameState = ReturnType<typeof useGameStore.getState>;

/** The PGN result when the game is decided ("*" means still in progress). */
export function decidedResult(result: string | null | undefined): string | null {
  return result && result !== "*" ? result : null;
}

export function gameModeLabel(game: Pick<GameState, "mode" | "source">): string {
  if (game.mode === "online" || game.source === "lichess") return "Lichess game";
  if (game.mode === "engine" || game.source === "engine-game") return "Engine game";
  if (game.mode === "puzzle" || game.source === "puzzle") return "Puzzle";
  if (game.mode === "analysis" || game.source === "analysis") return "Analysis";
  if (game.source === "pgn-import") return "Imported game";
  return "New game";
}

/**
 * Player names for the titlebar. In an engine game the engine's side shows the engine's name and
 * an unnamed human side shows "You". Null while both sides are unnamed.
 */
export function gamePlayerNames(
  game: Pick<GameState, "headers" | "mode" | "engineSide">,
  engineName: string | null
): { white: string; black: string } | null {
  const nameFor = (color: Color) => {
    const fallback = color === "white" ? "White" : "Black";
    const name = game.headers[color]?.trim() || fallback;
    if (game.mode !== "engine" || !game.engineSide) return name;
    if (game.engineSide === color) return engineName ?? name;
    return name === fallback ? "You" : name;
  };
  const white = nameFor("white");
  const black = nameFor("black");
  return white === "White" && black === "Black" ? null : { white, black };
}
