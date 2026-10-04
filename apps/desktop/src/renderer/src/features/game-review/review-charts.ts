import type { Color } from "@chaturanga/shared/types/chess";
import type { GameOpening, MoveAnnotation, MoveReview } from "@chaturanga/shared/types/engine";
import { formatMillisecondsClock } from "@chaturanga/shared/chess/clock-display";
import { gamePhases, type GamePhases } from "@chaturanga/shared/chess/game-phases";
import { bestMoveChance, difficultyModel } from "@chaturanga/shared/chess/maia-difficulty";
import { annotationLabel, winPercent } from "@chaturanga/shared/chess/move-assessment";
import { moveTimes } from "@chaturanga/shared/chess/move-times";
import { CHART_SCORE_LIMIT, moverIsWhite, whiteChartScore } from "./review-score";
import { moveLabel } from "./review-utils";

/** The start position's id in the move tree (game-store's root). */
const ROOT_NODE_ID = "root";

/** One point of the review's charts: the position after a move (the start at ply 0). */
export type ChartPoint = {
  ply: number;
  nodeId: string;
  /** "52. Ne4", "12… a5", "Start". */
  label: string;
  /** White's winning chances (Lichess WinPercent), 0–100. */
  whiteWin: number;
  /** The move's mark (Book included); null for an unmarked move and the start. */
  annotation: MoveAnnotation | null;
  /** One of the review's key moments. */
  key: boolean;
  /** Maia's chance, at the chart's model, of finding the engine's best move; null without it. */
  bestChance: number | null;
  /** Time the mover spent on the move (ms); null without clocks. */
  spentMs: number | null;
  /** The side that played the move; null for the start. */
  mover: Color | null;
};

export type ReviewChartData = {
  /** In game order; the first is the start position. */
  points: ChartPoint[];
  phases: GamePhases;
  /** The Maia model the difficulty is read at; null when the review has no Maia data. */
  model: number | null;
  hasDifficulty: boolean;
  hasTimes: boolean;
};

export type ReviewChartInput = {
  /** The review's main-line moves (as far as the review has gone). */
  moves: readonly MoveReview[];
  keyMomentIds?: ReadonlySet<string>;
  /** The review's opening (null: no named position; undefined: no book data). */
  opening: GameOpening | null | undefined;
  /** The game's whole main line, with each move's `[%clk]`. */
  mainline: readonly {
    nodeId: string;
    ply: number;
    fenBefore: string;
    clockAfter?: string | null;
  }[];
  /** The PGN TimeControl tag (its increment counts in the move times). */
  timeControl: string | null | undefined;
  maia: {
    /** The model the review was made for (`GameReview.rating.maiaModel`). */
    model: number | null;
    /** The reviewed side's rating: picks the nearest model when the review's own isn't stored. */
    rating: number;
    /** The review's Maia data is real (schema 2+); older reviews carry none worth showing. */
    trusted: boolean;
  };
};

/** White's winning chances after a move: a checkmate is decided, a mate to come is the ceiling. */
function whiteWinAfter(move: MoveReview): number {
  if (
    move.terminal === "checkmate" ||
    (move.evalAfter?.type === "mate" && move.evalAfter.value === 0)
  )
    return moverIsWhite(move) ? 100 : 0;
  return winPercent(whiteChartScore(move));
}

/** White's winning chances in the position before the first move (its `evalBefore`). */
function whiteWinAtStart(first: MoveReview | undefined): number {
  const score = first?.evalBefore;
  if (!score) return 50;
  if (score.type === "mate")
    return winPercent(score.value >= 0 ? CHART_SCORE_LIMIT : -CHART_SCORE_LIMIT);
  return winPercent(score.value);
}

/**
 * The points of the review's linked charts: winning chances, Maia difficulty and time spent per
 * move, with the game's phases. Pure, so the charts redraw only when the review changes.
 */
export function buildReviewChartData(input: ReviewChartInput): ReviewChartData {
  const { moves, keyMomentIds, maia } = input;
  const model = maia.trusted ? difficultyModel(moves, maia.model, maia.rating) : null;
  const times = moveTimes(input.mainline, input.timeControl);
  const spentByNode = new Map(input.mainline.map((move, index) => [move.nodeId, times[index]]));
  const points: ChartPoint[] = [
    {
      ply: 0,
      nodeId: ROOT_NODE_ID,
      label: "Start",
      whiteWin: whiteWinAtStart(moves[0]),
      annotation: null,
      key: false,
      bestChance: null,
      spentMs: null,
      mover: null
    }
  ];
  for (const move of moves) {
    points.push({
      ply: move.ply,
      nodeId: move.nodeId,
      label: moveLabel(move),
      whiteWin: whiteWinAfter(move),
      annotation: move.assessment?.annotation ?? null,
      key: keyMomentIds?.has(move.nodeId) ?? false,
      bestChance: model === null ? null : bestMoveChance(move, model),
      spentMs: spentByNode.get(move.nodeId) ?? null,
      mover: moverIsWhite(move) ? "white" : "black"
    });
  }
  return {
    points,
    phases: gamePhases(input.mainline, input.opening),
    model,
    hasDifficulty: points.some((point) => point.bestChance !== null),
    hasTimes: points.some((point) => point.spentMs !== null)
  };
}

/** A mark worth a dot or a coloured bar: every mark but Book (opening theory stays neutral). */
export function chartMark(annotation: MoveAnnotation | null): MoveAnnotation | null {
  return annotation === "book" ? null : annotation;
}

/** The index of the point nearest `ply` (the points are in ply order); -1 when there are none. */
export function nearestPointIndex(points: readonly Pick<ChartPoint, "ply">[], ply: number): number {
  if (!points.length) return -1;
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (points[middle].ply < ply) low = middle + 1;
    else high = middle;
  }
  if (low > 0 && Math.abs(points[low - 1].ply - ply) <= Math.abs(points[low].ply - ply))
    return low - 1;
  return low;
}

/**
 * The charts' tooltip for a point, one line each, leaving out what the review doesn't know:
 * "52. Ne4 · Blunder", "You 3% · Opponent 97%", "12% at 1500 find the best move", "0:43 spent".
 */
export function chartTooltipLines(
  point: ChartPoint,
  reviewedSide: Color,
  model: number | null
): string[] {
  const you = Math.round(reviewedSide === "white" ? point.whiteWin : 100 - point.whiteWin);
  const lines = [
    point.annotation ? `${point.label} · ${annotationLabel(point.annotation)}` : point.label,
    `You ${you}% · Opponent ${100 - you}%`
  ];
  if (point.bestChance !== null && model !== null)
    lines.push(`${Math.round(point.bestChance * 100)}% at ${model} find the best move`);
  if (point.spentMs !== null) lines.push(`${formatMillisecondsClock(point.spentMs)} spent`);
  return lines;
}
