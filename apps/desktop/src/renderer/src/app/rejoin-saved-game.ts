import { engineDisplayName } from "@chaturanga/shared/engine/managed";
import { parseClock, parseTimeControl } from "@chaturanga/shared/chess/move-times";
import { clocksOnPathToNode, exportGameToPgn } from "@chaturanga/shared/chess/pgn";
import type {
  Color,
  GameHeaders,
  MoveNode,
  SavedGame,
  SaveGameInput
} from "@chaturanga/shared/types/chess";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import { sessionFromSavedGame } from "../features/game/saved-game";
import { latestPlayedNode, timeForfeitOutcome, type GameOutcome } from "../stores/game-store";

/** An engine game without a clock: the engine thinks this long per move. */
export const ENGINE_MOVE_TIME_MS = 1000;

type EngineChoice = Pick<EngineConfig, "id" | "name" | "isAvailable">;

/**
 * Your side in a saved engine game: the one side named "You" (as Play writes it). Null when
 * neither or both are, so who played the engine can't be told.
 */
export function yourSide(white: string | null | undefined, black: string | null | undefined) {
  const you = (name: string | null | undefined) => name?.trim().toLowerCase() === "you";
  if (you(white) === you(black)) return null;
  return you(white) ? ("white" as const) : ("black" as const);
}

/**
 * Who plays whom in a saved engine game, to play it on: "You" on one side, and the installed,
 * available engine that played the other — by the id the game saved, else (older games) by the
 * name shown, so a game saved as "Stockfish (managed)" finds today's Stockfish. Null when either
 * can't be told or isn't there.
 */
export function savedEngineMatch(
  headers: Pick<GameHeaders, "white" | "black" | "engineId">,
  engines: readonly EngineChoice[]
): { engine: EngineChoice; engineSide: Color; humanSide: Color } | null {
  const humanSide = yourSide(headers.white, headers.black);
  if (!humanSide) return null;
  const engineSide: Color = humanSide === "white" ? "black" : "white";
  const byId = headers.engineId ? engines.find((item) => item.id === headers.engineId) : undefined;
  if (byId) return byId.isAvailable ? { engine: byId, engineSide, humanSide } : null;
  const name = engineDisplayName(headers[engineSide]?.trim() ?? "");
  if (!name) return null;
  const engine = engines.find((item) => item.isAvailable && engineDisplayName(item.name) === name);
  return engine ? { engine, engineSide, humanSide } : null;
}

/**
 * Why a saved engine game only opened (no match to play on): its engine isn't installed or isn't
 * available. Null when it can be played on, or when the sides can't be told (nothing to say).
 */
export function rejoinNotice(
  headers: Pick<GameHeaders, "white" | "black" | "engineId">,
  engines: readonly EngineChoice[]
): string | null {
  const humanSide = yourSide(headers.white, headers.black);
  if (!humanSide || savedEngineMatch(headers, engines)) return null;
  const engineSide: Color = humanSide === "white" ? "black" : "white";
  const name = engineDisplayName(headers[engineSide]?.trim() ?? "") || "Its engine";
  const installed =
    engines.some((item) => item.id === headers.engineId) ||
    engines.some((item) => engineDisplayName(item.name) === name);
  return installed
    ? `${name} isn't available, so the game opened on the board.`
    : `${name} isn't installed, so the game opened on the board.`;
}

/** A saved timed engine game's clocks now: what to play on with, or the result if one flagged. */
export type SavedEngineClock = {
  config: { initialMs: number; incrementMs: number };
  /** Time left now: the side to move's clock has run since its turn began (`playedAt`). */
  whiteMs: number;
  blackMs: number;
  sideToMove: Color;
  /** Where the game is: its latest move. */
  nodeId: string;
  /** The side to move ran out of time: the game is over (lost on time, or drawn). */
  flagged: GameOutcome | null;
};

/**
 * The clocks of a saved engine game at `nowMs` (epoch ms): each side's last recorded clock on the
 * way to the game's latest move (the time control's start before its first move), less the time
 * since that move for the side to move — its clock kept running while the game was away, the app
 * closed or the computer asleep. Null for a game without a clock: untimed, or saved before
 * engine games kept their clocks (it is played on without one).
 */
export function savedEngineClock(
  moveTree: readonly MoveNode[],
  timeControl: string | null | undefined,
  nowMs: number
): SavedEngineClock | null {
  const config = parseTimeControl(timeControl);
  if (!config || config.baseMs <= 0) return null;
  const node = latestPlayedNode(moveTree) ?? mainlineEndNode(moveTree);
  if (!node) return null;
  const recorded = clocksOnPathToNode([...moveTree], node.id);
  if (recorded.white === null && recorded.black === null && node.playedAt === undefined)
    return null;
  const sideToMove: Color = node.fenAfter.trim().split(/\s+/)[1] === "b" ? "black" : "white";
  const elapsed = node.playedAt === undefined ? 0 : Math.max(0, nowMs - node.playedAt);
  const left = (side: Color) => {
    const ms = parseClock(recorded[side]) ?? config.baseMs;
    return side === sideToMove ? Math.max(0, ms - elapsed) : ms;
  };
  const whiteMs = left("white");
  const blackMs = left("black");
  const flagged =
    (sideToMove === "white" ? whiteMs : blackMs) <= 0
      ? timeForfeitOutcome(node.fenAfter, sideToMove)
      : null;
  return {
    config: { initialMs: config.baseMs, incrementMs: config.incrementMs },
    whiteMs,
    blackMs,
    sideToMove,
    nodeId: node.id,
    flagged
  };
}

/**
 * The library write that ends a saved game on time (lost while away, before it was rejoined): its
 * moves and cursor as saved, with the result and termination; its stored analyses stay.
 */
export function timeForfeitSave(saved: SavedGame, outcome: GameOutcome): SaveGameInput {
  const session = sessionFromSavedGame(saved);
  const headers: GameHeaders = {
    ...session.headers,
    result: outcome.result,
    termination: outcome.termination
  };
  return {
    id: saved.id,
    source: saved.source,
    headers,
    rootFen: session.rootFen,
    currentFen: session.currentFen,
    currentNodeId: session.currentNodeId,
    moveTree: session.moveTree,
    pgn: exportGameToPgn({ headers, moveTree: session.moveTree }),
    ...(session.analysisBoard === undefined ? {} : { analysisBoard: session.analysisBoard })
  };
}

function mainlineEndNode(moveTree: readonly MoveNode[]): MoveNode | null {
  const byId = new Map(moveTree.map((node) => [node.id, node]));
  let node = moveTree.find((item) => item.parentId === null) ?? null;
  while (node?.children[0] && byId.has(node.children[0])) node = byId.get(node.children[0]) ?? null;
  return node;
}
