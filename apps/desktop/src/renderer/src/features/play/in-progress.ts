import { engineDisplayName } from "@chaturanga/shared/engine/managed";
import type { Color, MoveNode } from "@chaturanga/shared/types/chess";
import type { LichessPlayingGame, LichessSpeed } from "@chaturanga/shared/types/lichess";
import { mainlinePath } from "../game/move-tree-model";
import { yourSide } from "../../app/rejoin-saved-game";
import { speedLabel } from "../lichess/lichess-game";

/** The Lichess game on the board, as the In progress card needs it. */
export type LiveGameInput = {
  /** Its saved library id (the board's game), if it has one yet. */
  savedId: string | null;
  opponent: string;
  /** "10+0", or null for a game without a clock. */
  clock: string | null;
  speed: LichessSpeed;
  rated: boolean;
  yourColor: Color;
  fen: string;
  lastMove: string | null;
};

/** The engine match on the board (still running). */
export type BoardMatchInput = {
  savedId: string | null;
  engineName: string;
  humanColor: Color;
  fen: string;
  lastMove: string | null;
};

/** The newest saved engine game without a result. */
export type SavedGameInput = {
  id: string;
  white: string | null;
  black: string | null;
  fen: string;
  lastMove: string | null;
  plies: number;
};

export type InProgressCard = {
  /** What Rejoin does: back to the live game, resume a Lichess game, show the board, open a save. */
  source: "live" | "lichess" | "board" | "saved";
  /** The Lichess game id (lichess) or the saved game's id (saved); null otherwise. */
  targetId: string | null;
  /** The saved game this card shows, left out of Recent games. */
  excludeGameId: string | null;
  live: boolean;
  tag: string;
  title: string;
  detail: string;
  fen: string;
  lastMove: string | null;
  orientation: Color;
};

/**
 * The game the In progress card offers to rejoin, first match wins: the Lichess game on the board,
 * a Lichess game of yours in progress elsewhere (one where it's your move first), the engine match
 * on the board, then the newest saved unfinished engine game with at least one move and "You" on
 * exactly one side. Null when there is none.
 */
export function pickInProgress({
  live,
  playing,
  boardMatch,
  saved
}: {
  live: LiveGameInput | null;
  playing: readonly LichessPlayingGame[];
  boardMatch: BoardMatchInput | null;
  saved: SavedGameInput | null;
}): InProgressCard | null {
  if (live) {
    const yourTurn = sideToMove(live.fen) === live.yourColor;
    return {
      source: "live",
      targetId: null,
      excludeGameId: live.savedId,
      live: true,
      tag: "Live on Lichess",
      title: `You vs ${live.opponent}`,
      detail: lichessDetail(
        live.clock ?? speedLabel(live.speed),
        live.rated,
        yourTurn,
        live.opponent
      ),
      fen: live.fen,
      lastMove: live.lastMove,
      orientation: live.yourColor
    };
  }
  const online = playing.find((game) => game.isMyTurn) ?? playing.at(0);
  if (online) {
    return {
      source: "lichess",
      targetId: online.id,
      excludeGameId: null,
      live: true,
      tag: "Live on Lichess",
      title: `You vs ${online.opponent.name}`,
      detail: lichessDetail(
        speedLabel(online.speed),
        online.rated,
        online.isMyTurn,
        online.opponent.name
      ),
      fen: online.fen,
      lastMove: online.lastMove,
      orientation: online.yourColor
    };
  }
  if (boardMatch) {
    const engine = engineDisplayName(boardMatch.engineName) || "Engine";
    return {
      source: "board",
      targetId: null,
      excludeGameId: boardMatch.savedId,
      live: false,
      tag: "In progress",
      title: `You vs ${engine}`,
      detail: engineDetail(boardMatch.fen, boardMatch.humanColor, engine),
      fen: boardMatch.fen,
      lastMove: boardMatch.lastMove,
      orientation: boardMatch.humanColor
    };
  }
  const sides = saved ? savedEngineGameSides(saved.white, saved.black) : null;
  if (saved && saved.plies > 0 && sides) {
    return {
      source: "saved",
      targetId: saved.id,
      excludeGameId: saved.id,
      live: false,
      tag: "In progress",
      title: `You vs ${sides.engine}`,
      detail: engineDetail(saved.fen, sides.human, sides.engine),
      fen: saved.fen,
      lastMove: saved.lastMove,
      orientation: sides.human
    };
  }
  return null;
}

/** "10+0 · Rated · your move" (or "<opponent> to move"). */
function lichessDetail(clock: string, rated: boolean, yourTurn: boolean, opponent: string) {
  return [clock, rated ? "Rated" : "Casual", yourTurn ? "your move" : `${opponent} to move`].join(
    " · "
  );
}

/** "Engine game · Move 7 · your move" (or "Stockfish to move"); the move number from the FEN. */
function engineDetail(fen: string, human: Color, engine: string) {
  const turn = sideToMove(fen) === human ? "your move" : `${engine} to move`;
  return `Engine game · Move ${fullMoveNumber(fen)} · ${turn}`;
}

/**
 * Which side you played in a saved engine game: the one side named "You" (as Play writes it; see
 * yourSide, which rejoining uses too); the other side is the engine, shown by its display name.
 * Null when neither or both sides are "You".
 */
export function savedEngineGameSides(
  white: string | null,
  black: string | null
): { human: Color; engine: string } | null {
  const human = yourSide(white, black);
  if (!human) return null;
  const engine = (human === "white" ? black : white)?.trim();
  return { human, engine: engine ? engineDisplayName(engine) : "Engine" };
}

function sideToMove(fen: string): Color {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}

function fullMoveNumber(fen: string): number {
  const value = Number(fen.split(" ")[5]);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

/** The end of a game's main line: its position, last move and length (plies). */
export function mainlineSummary(
  moveTree: readonly MoveNode[]
): { fen: string; lastMove: string | null; plies: number } | null {
  const path = mainlinePath(moveTree);
  const end = path.at(-1);
  if (!end) return null;
  const plies = path.length - 1;
  return { fen: end.fenAfter, lastMove: plies ? end.uci : null, plies };
}
