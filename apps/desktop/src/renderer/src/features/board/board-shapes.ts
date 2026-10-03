import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Key } from "@lichess-org/chessground/types";
import { legalDestsForFen, statusForFen } from "@chaturanga/shared/chess/position";
import type {
  AnnotationColor,
  BoardArrow,
  BoardHighlight,
  Color
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
