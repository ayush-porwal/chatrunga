import type { Color } from "@chaturanga/shared/types/chess";
import type { GameOpening, MoveAnnotation, MoveReview } from "@chaturanga/shared/types/engine";
import { formatMillisecondsDuration } from "@chaturanga/shared/chess/clock-display";
import { gamePhases, type GamePhases } from "@chaturanga/shared/chess/game-phases";
import { bestMoveChance, difficultyModel } from "@chaturanga/shared/chess/maia-difficulty";
import { annotationLabel } from "@chaturanga/shared/chess/move-assessment";
import { moveTimes } from "@chaturanga/shared/chess/move-times";
import { moverIsWhite, whiteWinAfter, whiteWinBefore } from "./review-score";
import { plyLabel } from "./review-summary";

/** The start position's id in the move tree (game-store's root). */
const ROOT_NODE_ID = "root";

/** One point of the review's charts: the position after a move (the start at ply 0). */
export type ChartPoint = {
  ply: number;
  nodeId: string;
  /** "52. Ne4", "12… a5", "Start". */
  label: string;
  /** White's winning chances (Lichess WinPercent), 0–100; null for a move without an evaluation. */
  whiteWin: number | null;
  /** The move's mark (Book included); null for an unmarked move and the start. */
  annotation: MoveAnnotation | null;
  /** One of the review's key moments. */
  key: boolean;
  /** Maia's chance, at `maiaRating`, of finding the engine's best move; null without it. */
  bestChance: number | null;
  /** The rating Maia read the move at: the mover's (Maia 3), the chart's model (Maia 1). */
  maiaRating: number | null;
  /** Time the mover spent on the move (ms); null without clocks. */
  spentMs: number | null;
  /** The side that played the move; null for the start. */
  mover: Color | null;
};

export type ReviewChartData = {
  /** In game order; the first is the start position. */
  points: ChartPoint[];
  phases: GamePhases;
  /**
   * The Maia model the difficulty is read at (Maia 3 moves: each at its mover's rating, see
   * `ChartPoint.maiaRating`); null when the review has no Maia data.
   */
  model: number | null;
  /** Some move has an evaluation (the game was reviewed): the winning chances can be drawn. */
  hasEvals: boolean;
  hasDifficulty: boolean;
  hasTimes: boolean;
};

export type ChartMainlineMove = {
  nodeId: string;
  ply: number;
  san: string;
  fenBefore: string;
  clockAfter?: string | null;
};

export type ReviewChartInput = {
  /** The review's main-line moves (as far as the review has gone; none for an unreviewed game). */
  moves: readonly MoveReview[];
  keyMomentIds?: ReadonlySet<string>;
  /** The review's opening (null: no named position; undefined: no book data). */
  opening: GameOpening | null | undefined;
  /** The game's whole main line, with each move's `[%clk]`: one point per move. */
  mainline: readonly ChartMainlineMove[];
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

/**
 * The points of the review's linked charts, one per main-line move: winning chances, Maia
 * difficulty and time spent, with the game's phases. A move the review hasn't reached (or a game
 * with no review) has only what its clocks tell. Pure, so the charts redraw only when the review
 * or the game changes.
 */
export function buildReviewChartData(input: ReviewChartInput): ReviewChartData {
  const { moves, keyMomentIds, maia } = input;
  const model = maia.trusted ? difficultyModel(moves, maia.model, maia.rating) : null;
  const times = moveTimes(input.mainline, input.timeControl);
  const reviewByNode = new Map(moves.map((move) => [move.nodeId, move]));
  const points: ChartPoint[] = [
    {
      ply: 0,
      nodeId: ROOT_NODE_ID,
      label: "Start",
      // The position before the first move (even without its evaluation).
      whiteWin: moves[0] ? (whiteWinBefore(moves[0]) ?? 50) : null,
      annotation: null,
      key: false,
      bestChance: null,
      maiaRating: null,
      spentMs: null,
      mover: null
    }
  ];
  input.mainline.forEach((item, index) => {
    const move = reviewByNode.get(item.nodeId);
    const bestChance = move && model !== null ? bestMoveChance(move, model) : null;
    points.push({
      ply: item.ply,
      nodeId: item.nodeId,
      label: plyLabel(item.ply, item.san),
      whiteWin: move ? whiteWinAfter(move) : null,
      annotation: move?.assessment?.annotation ?? null,
      key: keyMomentIds?.has(item.nodeId) ?? false,
      bestChance,
      maiaRating: bestChance === null ? null : (move?.moverPrediction?.rating ?? model),
      spentMs: times[index] ?? null,
      mover: moverIsWhite(item) ? "white" : "black"
    });
  });
  return {
    points,
    phases: gamePhases(input.mainline, input.opening),
    model,
    hasEvals: points.some((point) => point.whiteWin !== null),
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

/** One row of the charts' tooltip: what it is, and its value. */
export type ChartTooltipRow = { label: string; value: string };

/**
 * The difficulty strip's title, from the ratings its moves were read at: "Difficulty at 1500 ·
 * Maia" when there is one (a Maia 1 model, or both sides at one rating), "Difficulty at White 1500
 * · Black 1700 · Maia" for Maia 3 sides at their own ratings. Null without difficulty.
 */
export function difficultyTitle(points: readonly ChartPoint[]): string | null {
  const bySide = { white: new Set<number>(), black: new Set<number>() };
  for (const point of points)
    if (point.mover && point.maiaRating !== null) bySide[point.mover].add(point.maiaRating);
  const all = new Set([...bySide.white, ...bySide.black]);
  if (!all.size) return null;
  const [only] = all;
  if (all.size === 1) return `Difficulty at ${only} · Maia`;
  const side = (ratings: Set<number>) => [...ratings].sort((a, b) => a - b).join("/");
  return `Difficulty at White ${side(bySide.white)} · Black ${side(bySide.black)} · Maia`;
}

/**
 * The charts' tooltip for a point: its move and mark ("52. Ne4 · Blunder"), then a row each for
 * what the review knows of it, each naming where it comes from: both sides' winning chances by the
 * review's engine (`engine`, its display name; unnamed when unknown), how often players at the
 * rating Maia read the move at find the best move, and the time spent.
 */
export function chartTooltip(
  point: ChartPoint,
  reviewedSide: Color,
  engine: string | null = null
): { title: string; rows: ChartTooltipRow[] } {
  const title = point.annotation
    ? `${point.label} · ${annotationLabel(point.annotation)}`
    : point.label;
  const rows: ChartTooltipRow[] = [];
  if (point.whiteWin !== null) {
    const you = Math.round(reviewedSide === "white" ? point.whiteWin : 100 - point.whiteWin);
    rows.push(
      { label: engine ? `Your chances · ${engine}` : "Your chances", value: `${you}%` },
      { label: "Opponent's", value: `${100 - you}%` }
    );
  }
  if (point.bestChance !== null && point.maiaRating !== null)
    rows.push({
      label: `Best move at ${point.maiaRating} · Maia`,
      value: `${Math.round(point.bestChance * 100)}%`
    });
  if (point.spentMs !== null)
    rows.push({ label: "Time spent", value: formatMillisecondsDuration(point.spentMs) });
  return { title, rows };
}

/** The Winning chances strip's title, naming the engine whose evaluations it plots (when known). */
export function winningChancesTitle(engine: string | null): string {
  return engine ? `Winning chances · ${engine}` : "Winning chances";
}

/** The tooltip as one sentence, for screen readers: "52. Ne4 · Blunder, Your chances 3%, …". */
export function chartTooltipText(tooltip: ReturnType<typeof chartTooltip>): string {
  return [tooltip.title, ...tooltip.rows.map((row) => `${row.label} ${row.value}`)].join(", ");
}
