import type { DrawShape } from "@lichess-org/chessground/draw";
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
import type { MoveReview } from "@chaturanga/shared/types/engine";
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
    return legalDestsForFen(fen);
  } catch {
    return new Map();
  }
}

/** Chessground's `movable.color` for a board's movable setting (undefined means nobody). */
export function chessgroundMovableColor(movable: BoardMovable): Color | "both" | undefined {
  return movable === "none" ? undefined : movable;
}

/**
 * Chessground's green drawn dashed (ControlledBoard adds the brush, board.css dashes it): a move
 * that is one of several, beside the solid green of the main one (Study's repertoire arrows).
 */
export const DASHED_GREEN_BRUSH = "dashedGreen";

/** The board's engine arrows setting (on or off) and how many plan arrows it shows (0: the best move alone). */
type EngineArrowOptions = { bestMoveArrow: boolean; planArrows: number };

/** The most moves of the engine's top line plan arrows draw (Analysis settings offer 2–4). */
const PLAN_ARROWS_MAX = 4;

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
 * Live analysis arrows in `fen` from the engine's top line (UCI moves), none while engine arrows
 * (`bestMoveArrow`) are off. With a plan count, that many of its moves as numbered arrows;
 * without, its first move as the single best-move arrow. Every one in Chessground's default blue.
 * Only moves legal in turn are drawn, so a line left over from another position draws nothing.
 */
export function liveAnalysisShapes(
  fen: string,
  line: readonly string[],
  options: EngineArrowOptions
): DrawShape[] {
  // Engine arrows off: none at all, whatever the plan count says.
  if (!options.bestMoveArrow) return [];
  const plan = Math.min(Math.max(0, Math.floor(options.planArrows)), PLAN_ARROWS_MAX);
  if (!plan)
    return legalLineSquares(fen, line, 1).map(([orig, dest]) => ({ orig, dest, brush: "blue" }));
  // Each number is Chessground's own arrow label: a disc in the arrow's colour on its shaft, where
  // the arrowhead starts (it steps back when arrows meet on a square).
  return legalLineSquares(fen, line, plan).map(([orig, dest], index) => ({
    orig,
    dest,
    brush: "blue",
    label: { text: String(index + 1) }
  }));
}

/**
 * The review arrows' options: the engine arrows setting, and `pale` for Chessground's pale brushes
 * (Analyze's board draws a review's best and played arrows pale; the plan's numbered arrows stay
 * the live analysis blue).
 */
type ReviewArrowOptions = EngineArrowOptions & { pale?: boolean };

/**
 * A reviewed move's arrows, on the board after it. The engine's, while engine arrows are on: its
 * best move in green or, with a plan count, that many moves of its best line from the position
 * before the move, numbered in blue as live analysis draws them. Then the move played, unless it
 * was the best one: red when it cost something (any error, marked or not), blue otherwise.
 */
export function reviewMoveShapes(
  move: MoveReview | null,
  options: ReviewArrowOptions
): DrawShape[] {
  if (!move) return [];
  const best = move.bestMove ? uciSquares(move.bestMove) : null;
  const shapes = reviewEngineShapes(move, best, options);
  const played = uciSquares(move.playedMove);
  if (played && (played[0] !== best?.[0] || played[1] !== best[1])) {
    const brush = move.assessment?.severity ? "red" : "blue";
    shapes.push({ orig: played[0], dest: played[1], brush: paleBrush(brush, options) });
  }
  return shapes;
}

/** The engine's arrows for a reviewed move (see {@link reviewMoveShapes}). */
function reviewEngineShapes(
  move: MoveReview,
  best: [from: Square, to: Square] | null,
  options: ReviewArrowOptions
): DrawShape[] {
  if (!options.bestMoveArrow) return [];
  if (options.planArrows > 0) {
    const line = move.bestLine.length ? move.bestLine : move.bestMove ? [move.bestMove] : [];
    const plan = liveAnalysisShapes(move.fenBefore, line, options);
    // A line that isn't legal from the position before (never trusted) falls back to the best move.
    if (plan.length) return plan;
  }
  return best ? [{ orig: best[0], dest: best[1], brush: paleBrush("green", options) }] : [];
}

/** Chessground's pale variant of a brush when the arrows are drawn pale (Analyze's board). */
function paleBrush(brush: "green" | "red" | "blue", options: ReviewArrowOptions): string {
  return options.pale ? PALE_BRUSHES[brush] : brush;
}

const PALE_BRUSHES = { green: "paleGreen", red: "paleRed", blue: "paleBlue" } as const;
