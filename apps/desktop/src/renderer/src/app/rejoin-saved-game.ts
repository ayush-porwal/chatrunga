import { engineDisplayName } from "@chaturanga/shared/engine/managed";
import type { Color, GameHeaders } from "@chaturanga/shared/types/chess";
import type { EngineConfig } from "@chaturanga/shared/types/engine";

/** An engine game rejoined from Play has no clock: the engine thinks this long per move. */
export const ENGINE_MOVE_TIME_MS = 1000;

/**
 * Who plays whom in a saved engine game, to play it on: "You" on one side, and the installed,
 * available engine whose name is on the other (matched by the name shown, so a game saved as
 * "Stockfish (managed)" finds today's Stockfish). Null when either can't be told or isn't there.
 */
export function savedEngineMatch(
  headers: Pick<GameHeaders, "white" | "black">,
  engines: readonly Pick<EngineConfig, "id" | "name" | "isAvailable">[]
): {
  engine: Pick<EngineConfig, "id" | "name" | "isAvailable">;
  engineSide: Color;
  humanSide: Color;
} | null {
  const you = (color: Color) => headers[color]?.trim() === "You";
  if (you("white") === you("black")) return null;
  const humanSide: Color = you("white") ? "white" : "black";
  const engineSide: Color = humanSide === "white" ? "black" : "white";
  const name = engineDisplayName(headers[engineSide]?.trim() ?? "");
  if (!name) return null;
  const engine = engines.find((item) => item.isAvailable && engineDisplayName(item.name) === name);
  return engine ? { engine, engineSide, humanSide } : null;
}
