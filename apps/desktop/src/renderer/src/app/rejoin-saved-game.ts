import { engineDisplayName } from "@chaturanga/shared/engine/managed";
import { parseClock, parseTimeControl } from "@chaturanga/shared/chess/move-times";
import { clocksOnPathToNode, exportGameToPgn } from "@chaturanga/shared/chess/pgn";
import { statusForFen } from "@chaturanga/shared/chess/position";
import type {
  Color,
  GameHeaders,
  MoveNode,
  SavedGame,
  SaveGameInput
} from "@chaturanga/shared/types/chess";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import type { EngineIdentity } from "@/lib/engine-identity";
import { isMaiaEngine, isMaiaPlayer } from "../features/play/engine-game";
import { mainlineEnd } from "../features/game/move-tree-model";
import { sessionFromSavedGame } from "../features/game/saved-game";
import { latestPlayedNode, timeForfeitOutcome, type GameOutcome } from "../stores/game-store";

/** An engine game without a clock: the engine thinks this long per move. */
export const ENGINE_MOVE_TIME_MS = 1000;

type EngineChoice = Pick<EngineConfig, "id" | "name" | "isAvailable"> &
  Partial<Pick<EngineConfig, "runtime">>;

/**
 * Your side in a saved engine game: the one side named "You" (as Play writes it). Null when
 * neither or both are, so who played the engine can't be told.
 */
export function yourSide(white: string | null | undefined, black: string | null | undefined) {
  const you = (name: string | null | undefined) => name?.trim().toLowerCase() === "you";
  if (you(white) === you(black)) return null;
  return you(white) ? ("white" as const) : ("black" as const);
}

/** The engine's side of a saved engine game: the side that isn't "You" (see yourSide). */
function engineSideOf(headers: Pick<GameHeaders, "white" | "black">): Color | null {
  const humanSide = yourSide(headers.white, headers.black);
  if (!humanSide) return null;
  return humanSide === "white" ? "black" : "white";
}

/**
 * The installed engine that played `engineSide` of a saved engine game: the one with the id the
 * game saved, else (older games, or that engine since removed) the first `nameMatches` accepts
 * with the name shown, so a game saved as "Stockfish (managed)" finds today's Stockfish. A side
 * named as Maia at a rating ("Maia 1500", a Maia 1 game's "Maia 1500 (managed)") that no engine
 * is named for is Maia 3, which plays every rating.
 */
function savedGameEngine<E extends Pick<EngineConfig, "id" | "name"> & EngineIdentity>(
  headers: Pick<GameHeaders, "white" | "black" | "engineId">,
  engineSide: Color,
  engines: readonly E[],
  nameMatches: (engine: E) => boolean = () => true
): E | undefined {
  const byId = headers.engineId ? engines.find((item) => item.id === headers.engineId) : undefined;
  if (byId) return byId;
  const name = engineDisplayName(headers[engineSide]?.trim() ?? "");
  if (!name) return undefined;
  const byName = engines.find((item) => nameMatches(item) && engineDisplayName(item.name) === name);
  if (byName || !isMaiaPlayer(name)) return byName;
  return engines.find((item) => nameMatches(item) && isMaiaEngine(item));
}

/**
 * Who plays whom in a saved engine game, to play it on: "You" on one side, and the installed,
 * available engine that played the other (see savedGameEngine). Null when either can't be told or
 * isn't there.
 */
export function savedEngineMatch(
  headers: Pick<GameHeaders, "white" | "black" | "engineId">,
  engines: readonly EngineChoice[]
): { engine: EngineChoice; engineSide: Color; humanSide: Color } | null {
  const engineSide = engineSideOf(headers);
  if (!engineSide) return null;
  const engine = savedGameEngine(headers, engineSide, engines, (item) => item.isAvailable);
  const humanSide: Color = engineSide === "white" ? "black" : "white";
  return engine?.isAvailable ? { engine, engineSide, humanSide } : null;
}

/**
 * The engine's side of a saved engine game ("You" on the other) and what its picture is drawn
 * from: the installed engine that played it (by id, else by name; available or not), else just
 * the name the game shows. Null when the sides can't be told or the engine's side is unnamed.
 */
export function savedEngineSide(
  headers: Pick<GameHeaders, "white" | "black" | "engineId">,
  engines: readonly (EngineIdentity & Pick<EngineConfig, "id">)[]
): { side: Color; engine: EngineIdentity } | null {
  const side = engineSideOf(headers);
  if (!side) return null;
  const installed = savedGameEngine(headers, side, engines);
  if (installed) return { side, engine: installed };
  const name = headers[side]?.trim();
  return name ? { side, engine: { name } } : null;
}

/**
 * Why a saved engine game only opened (no match to play on), and whether to offer Maia 3's
 * download with it.
 */
export type RejoinNotice = {
  message: string;
  /** Maia played the game and Maia 3 (which plays every rating) isn't installed. */
  offerMaia3: boolean;
};

/**
 * Why a saved engine game only opened (no match to play on): its engine isn't installed or isn't
 * available. Null when it can be played on, or when the sides can't be told (nothing to say).
 */
export function rejoinNotice(
  headers: Pick<GameHeaders, "white" | "black" | "engineId">,
  engines: readonly EngineChoice[]
): RejoinNotice | null {
  const engineSide = engineSideOf(headers);
  if (!engineSide || savedEngineMatch(headers, engines)) return null;
  const name = engineDisplayName(headers[engineSide]?.trim() ?? "") || "Its engine";
  if (savedGameEngine(headers, engineSide, engines))
    return {
      message: `${name} isn't available, so the game opened on the board.`,
      offerMaia3: false
    };
  if (isMaiaPlayer(name))
    return {
      message: `${name} plays on Maia 3, which isn't installed, so the game opened on the board.`,
      offerMaia3: true
    };
  return {
    message: `${name} isn't installed, so the game opened on the board.`,
    offerMaia3: false
  };
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
  const node = latestPlayedNode(moveTree) ?? mainlineEnd(moveTree);
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

/** The match a saved engine game goes on as: who plays whom, from which move, on which clocks. */
type RejoinMatch = {
  engine: EngineChoice;
  engineSide: Color;
  humanSide: Color;
  /** Its latest move: where the match goes on. */
  nodeId: string;
};

/** What rejoining a saved engine game does once the game is open on the board. */
export type RejoinPlan =
  /** Only opened: there's no match to play on; `notice` says why (null: nothing to say). */
  | { kind: "open"; notice: RejoinNotice | null }
  /** Already over at its latest move: shown there, not played on. */
  | { kind: "finished"; nodeId: string }
  /** Played on; without a clock (untimed, or saved before games kept them) at ENGINE_MOVE_TIME_MS. */
  | (RejoinMatch & { kind: "resume"; clock: SavedEngineClock | null })
  /** The side to move ran out of time while away: the match is set up and ends on time at once. */
  | (RejoinMatch & { kind: "timed-out"; clock: SavedEngineClock; outcome: GameOutcome });

/**
 * Rejoining a saved engine game (Play's In progress card) at `nowMs`: play on against its engine
 * from its latest move, with the time each side has now; end it on time when the side to move ran
 * out meanwhile; or only open it, with a notice when its engine is missing or unavailable.
 */
export function planRejoin(
  game: {
    headers: Pick<GameHeaders, "white" | "black" | "engineId" | "timeControl">;
    moveTree: readonly MoveNode[];
  },
  engines: readonly EngineChoice[],
  nowMs: number
): RejoinPlan {
  const match = savedEngineMatch(game.headers, engines);
  if (!match) return { kind: "open", notice: rejoinNotice(game.headers, engines) };
  const clock = savedEngineClock(game.moveTree, game.headers.timeControl, nowMs);
  const end = clock
    ? game.moveTree.find((node) => node.id === clock.nodeId)
    : mainlineEnd(game.moveTree);
  if (!end) return { kind: "open", notice: null };
  if (statusForFen(end.fenAfter).isEnd) return { kind: "finished", nodeId: end.id };
  const resumed = { ...match, nodeId: end.id };
  if (clock?.flagged) return { ...resumed, kind: "timed-out", clock, outcome: clock.flagged };
  return { ...resumed, kind: "resume", clock };
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
