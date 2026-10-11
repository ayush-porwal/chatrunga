import { isSquare, uciSquares } from "@chaturanga/shared/chess/square";
import { positionFromFen } from "@chaturanga/shared/chess/position";
import type { Color, Square } from "@chaturanga/shared/types/chess";
import { makeSquare } from "chessops/util";
import type { PreviewPieceRole } from "../settings/piece-style-preview";
import { operaGameMainline } from "./opera-game";

/*
 * The welcome's board: Morphy's finish from the Opera game, played like a looping GIF. Pure timing
 * and sequencing (Stage.tsx draws it): from the position after 9…b5, one move per tick through
 * 10.Nxb5! … 16.Qb8+!! Nxb8 17.Rd8#; then the mated king's square glows for a few ticks, the
 * pieces fade out, and the loop starts again from 9…b5.
 */

/** One move every tick. */
export const OPERA_LOOP_TICK_MS = 1600;

/** The ply the loop starts after: 9…b5. */
const FIRST_PLY = 18;
/** Ticks the mate is held (glowing) before the pieces fade out. */
const MATE_HOLD_TICKS = 3;

/** A piece on the loop's board. `id` is stable for the whole loop, so a moving piece slides. */
export type OperaLoopPiece = {
  id: string;
  color: Color;
  role: PreviewPieceRole;
  square: Square;
  /** Taken by this frame's move: still drawn, fading out. Gone from the next frame on. */
  captured: boolean;
};

export type OperaLoopFrame = {
  pieces: OperaLoopPiece[];
  /** The move that led here (highlighted), or null on the start position. */
  lastMove: readonly [from: Square, to: Square] | null;
};

/** What the board shows at one tick. */
export type OperaLoopView = {
  /** Which run of the loop (a new run draws fresh pieces, faded in). */
  cycle: number;
  /** Index into `operaLoopFrames()`. */
  frame: number;
  /** The mated king's square glows. */
  mate: boolean;
  /** The pieces fade out before the loop starts again. */
  fading: boolean;
};

/** The square of the king that is mated at the end (17.Rd8#). */
export const OPERA_LOOP_MATED_SQUARE: Square = "e8";

let frames: OperaLoopFrame[] | null = null;

/** The loop's frames: the start position, then one per move up to the mate. Built once. */
export function operaLoopFrames(): OperaLoopFrame[] {
  if (frames) return frames;
  const nodes = operaGameMainline();
  let pieces = startPieces(nodes[FIRST_PLY].fenAfter);
  const built: OperaLoopFrame[] = [{ pieces, lastMove: null }];
  for (const node of nodes.slice(FIRST_PLY + 1)) {
    const squares = node.uci ? uciSquares(node.uci) : null;
    if (!squares) throw new Error(`Opera game: no move at ply ${node.ply}`);
    const next = playMove(pieces, squares[0], squares[1]);
    built.push({ pieces: next.frame, lastMove: next.highlight });
    pieces = next.kept;
  }
  frames = built;
  return built;
}

/** Ticks in one run: the start, every move, the held mate, the fade. */
function operaLoopLength(): number {
  return operaLoopFrames().length + MATE_HOLD_TICKS + 1;
}

/** The board at `tick` (counted from the welcome opening; the loop never restarts per step). */
export function operaLoopView(tick: number): OperaLoopView {
  const length = operaLoopLength();
  const last = operaLoopFrames().length - 1;
  const at = Math.max(0, tick) % length;
  return {
    cycle: Math.floor(Math.max(0, tick) / length),
    frame: Math.min(at, last),
    mate: at > last,
    fading: at === length - 1
  };
}

/** Reduced motion: the final mate position, still. */
export function operaLoopFinalView(): OperaLoopView {
  return { cycle: 0, frame: operaLoopFrames().length - 1, mate: true, fading: false };
}

function startPieces(fen: string): OperaLoopPiece[] {
  const { board } = positionFromFen(fen);
  const pieces: OperaLoopPiece[] = [];
  for (const square of board.occupied) {
    const piece = board.get(square);
    if (!piece) continue;
    const name = makeSquare(square);
    pieces.push({ id: name, color: piece.color, role: piece.role, square: name, captured: false });
  }
  return pieces;
}

/**
 * Plays `from`→`to` (castling written either way: king to its destination or onto its rook).
 * Returns the frame to draw (the captured piece kept, flagged), the pieces that stay on the board
 * for the next move, and the squares to highlight.
 */
function playMove(
  pieces: OperaLoopPiece[],
  from: Square,
  to: Square
): {
  frame: OperaLoopPiece[];
  kept: OperaLoopPiece[];
  highlight: readonly [Square, Square];
} {
  const mover = pieces.find((piece) => piece.square === from);
  if (!mover) throw new Error(`Opera game: no piece on ${from}`);
  const castle = castling(mover, from, to);
  const target = castle ? castle.king : to;
  const moves = new Map<string, Square>([[mover.id, target]]);
  if (castle) {
    const rook = pieces.find((piece) => piece.square === castle.rookFrom);
    if (rook) moves.set(rook.id, castle.rookTo);
  }
  const frame = pieces.map((piece) => {
    const square = moves.get(piece.id);
    if (square) return { ...piece, square };
    return piece.square === to && !castle ? { ...piece, captured: true } : piece;
  });
  return {
    frame,
    kept: frame.filter((piece) => !piece.captured),
    highlight: [from, target]
  };
}

/** For a castling king move: where the king and its rook go. */
function castling(
  mover: OperaLoopPiece,
  from: Square,
  to: Square
): { king: Square; rookFrom: Square; rookTo: Square } | null {
  const fileFrom = from.charCodeAt(0);
  const fileTo = to.charCodeAt(0);
  if (mover.role !== "king" || Math.abs(fileTo - fileFrom) < 2) return null;
  const rank = from[1];
  const long = fileTo < fileFrom;
  return long
    ? { king: square(`c${rank}`), rookFrom: square(`a${rank}`), rookTo: square(`d${rank}`) }
    : { king: square(`g${rank}`), rookFrom: square(`h${rank}`), rookTo: square(`f${rank}`) };
}

function square(name: string): Square {
  if (!isSquare(name)) throw new Error(`Not a square: ${name}`);
  return name;
}
