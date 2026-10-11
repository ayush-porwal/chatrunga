import type { DrawBrush, DrawShape } from "@lichess-org/chessground/draw";
import type { Key } from "@lichess-org/chessground/types";
import { fenAfterUci, legalDestsForFen, statusForFen } from "@chaturanga/shared/chess/position";
import { uciSquares } from "@chaturanga/shared/chess/square";
import type {
  AnnotationColor,
  BoardArrow,
  BoardHighlight,
  Color,
  Square
} from "@chaturanga/shared/types/chess";
import { asSquare } from "@/lib/uci";

/** Which side(s) may move pieces on an interactive board; `none` makes it view only. */
export type BoardMovable = Color | "both" | "none";

const BRUSH_TO_COLOR: Record<string, AnnotationColor> = {
  green: "green",
  red: "red",
  yellow: "yellow",
  blue: "blue"
};

/** Chessground shapes for stored arrows and square highlights (the brush is the annotation colour). */
export function shapesFromAnnotations(
  arrows: readonly BoardArrow[],
  highlights: readonly BoardHighlight[]
): DrawShape[] {
  return [
    ...arrows.map((arrow) => ({
      orig: arrow.orig as Key,
      dest: arrow.dest as Key,
      brush: arrow.color
    })),
    ...highlights.map((highlight) => ({ orig: highlight.square as Key, brush: highlight.color }))
  ];
}

/**
 * Arrows and highlights for shapes drawn on the board. Unknown brushes fall back to green, and
 * shapes on squares that aren't real board squares are dropped.
 */
export function annotationsFromShapes(shapes: readonly DrawShape[]): {
  arrows: BoardArrow[];
  highlights: BoardHighlight[];
} {
  const arrows: BoardArrow[] = [];
  const highlights: BoardHighlight[] = [];
  for (const shape of shapes) {
    const color = BRUSH_TO_COLOR[shape.brush ?? "green"] ?? "green";
    const orig = asSquare(shape.orig);
    if (!orig) continue;
    const dest = shape.dest ? asSquare(shape.dest) : null;
    if (dest) arrows.push({ orig, dest, color });
    else if (!shape.dest) highlights.push({ square: orig, color });
  }
  return { arrows, highlights };
}

/** Whether the side to move in `fen` is one the board lets the user move. */
export function sideToMoveIsMovable(fen: string, movable: BoardMovable): boolean {
  if (movable === "none") return false;
  if (movable === "both") return true;
  try {
    return statusForFen(fen).turn === movable;
  } catch {
    return false;
  }
}

/**
 * Legal destinations Chessground may offer in `fen`, limited to the movable side: every legal
 * move when the side to move may move, none otherwise (and none for an unreadable position).
 */
export function movableDests(fen: string, movable: BoardMovable): Map<Key, Key[]> {
  if (!sideToMoveIsMovable(fen, movable)) return new Map();
  try {
    return legalDestsForFen(fen) as Map<Key, Key[]>;
  } catch {
    return new Map();
  }
}

/** Chessground's `movable.color` for a board's movable setting (undefined means nobody). */
export function chessgroundMovableColor(movable: BoardMovable): Color | "both" | undefined {
  return movable === "none" ? undefined : movable;
}

/** The most moves of the engine's top line plan arrows draw (Analysis settings offer 2–4). */
const PLAN_ARROWS_MAX = 4;

/**
 * Plan arrow brushes, one per move of the line: the side to move's moves in the best-move green,
 * the replies in blue, each a little fainter than the one before (Chessground draws every arrow at
 * 0.6 on top of its brush's opacity). Registered on the board alongside Chessground's own brushes.
 */
export const PLAN_ARROW_BRUSHES: Readonly<Record<string, DrawBrush>> = {
  plan1: { key: "plan1", color: "#15781B", opacity: 1, lineWidth: 10 },
  plan2: { key: "plan2", color: "#003088", opacity: 0.85, lineWidth: 10 },
  plan3: { key: "plan3", color: "#15781B", opacity: 0.7, lineWidth: 10 },
  plan4: { key: "plan4", color: "#003088", opacity: 0.55, lineWidth: 10 }
};

/** The squares of the moves of `line` that are legal one after another from `fen`, at most `count`. */
function legalLineSquares(
  fen: string,
  line: readonly string[],
  count: number
): [from: Square, to: Square][] {
  const squares: [from: Square, to: Square][] = [];
  let position = fen;
  for (const uci of line.slice(0, count)) {
    const move = uciSquares(uci);
    let next: string | null = null;
    try {
      next = fenAfterUci(position, uci);
    } catch {
      // An unreadable position: nothing more is drawn.
    }
    if (!move || !next) break;
    squares.push(move);
    position = next;
  }
  return squares;
}

/**
 * Live analysis arrows in `fen` from the engine's top line (UCI moves). With plan arrows on, that
 * many of its moves as numbered arrows (see {@link PLAN_ARROW_BRUSHES}); off, its first move as
 * the single best-move arrow when `bestMoveArrow` is on. Only moves legal in turn are drawn, so a
 * line left over from another position draws nothing.
 */
export function liveAnalysisShapes(
  fen: string,
  line: readonly string[],
  options: { bestMoveArrow: boolean; planArrows: number }
): DrawShape[] {
  const plan = Math.min(Math.max(0, Math.floor(options.planArrows)), PLAN_ARROWS_MAX);
  if (!plan) {
    if (!options.bestMoveArrow) return [];
    return legalLineSquares(fen, line, 1).map(([orig, dest]) => ({ orig, dest, brush: "blue" }));
  }
  // Each number is Chessground's own arrow label: a disc in the arrow's colour on its shaft, where
  // the arrowhead starts (it steps back when arrows meet on a square).
  return legalLineSquares(fen, line, plan).map(([orig, dest], index) => ({
    orig,
    dest,
    brush: `plan${index + 1}`,
    label: { text: String(index + 1) }
  }));
}
