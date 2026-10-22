import type {
  EngineScore,
  MoveAnnotation,
  MoveReview,
  RatingPrediction
} from "@chaturanga/shared/types/engine";
import { annotationTone } from "@/lib/ui";
import { uciToSan } from "./review-utils";

/*
 * The Engine tab's Human prediction (RatingCurve.tsx draws it), after Maia Chess's analysis panel:
 * Maia's moves at the mover's rating (Maia 3) or the user's level (Maia 1) beside the engine's, and
 * how often players at each rating play the move played, the best move and Maia's own pick, as
 * lines over the ratings Maia was read at (Maia 3's 21 from 600 to 2600, Maia 1's five levels).
 */

/** Who a line or a row stands for: the move played, the engine's best, or Maia's pick. */
export type PredictionRole = "played" | "best" | "maia";

export type PredictionLine = {
  role: PredictionRole;
  san: string;
  /** Maia's probability at each rating of the curve (its `ratings` order). */
  probs: readonly number[];
};

/** The curve's lines over the ratings Maia was read at, ascending. */
export type PredictionCurve = { ratings: readonly number[]; lines: PredictionLine[] };

/** What each line is called (the legend, the tooltip). */
export const PREDICTION_ROLE_NAMES: Record<PredictionRole, string> = {
  played: "Played",
  best: "Best",
  maia: "Maia's pick"
};

/** Marks of an error: the played line takes the mark's colour (any other move is neutral). */
const ERROR_MARKS = new Set<MoveAnnotation>(["inaccuracy", "mistake", "blunder", "miss"]);

/** Each line's colour: the played move's mark (an error's), the best move's green, Maia's grey. */
export function predictionColors(
  annotation: MoveAnnotation | null
): Record<PredictionRole, string> {
  return {
    played:
      annotation && ERROR_MARKS.has(annotation)
        ? annotationTone[annotation].fill
        : "var(--color-fg-secondary)",
    best: "var(--color-accent)",
    maia: "var(--color-fg-muted)"
  };
}

/** A move of a table: its SAN, what it is in this position (if anything) and its number. */
export type PredictionRow = {
  uci: string;
  san: string;
  role: Exclude<PredictionRole, "maia"> | null;
};

/** Maia's top moves at one rating and how likely each is. */
export type HumanMoveRow = PredictionRow & { prob: number };
/** The engine's candidate moves and their score (White's side). */
export type EngineMoveRow = PredictionRow & { score: EngineScore };

/** Rows of each table. */
const TABLE_ROWS = 4;

/** A share as the chart and the tables write it: "35%" ("<1%" for a trace). */
export function percent(value: number): string {
  const rounded = Math.round(value * 100);
  return rounded === 0 && value > 0 ? "<1%" : `${rounded}%`;
}

/**
 * The prediction the Human moves table reads: Maia 3's at the mover's rating, else the move's
 * prediction at `bucket` (markedRating): Maia 1's level nearest the user's rating, when Maia ran
 * there, or, on a Maia 3 move a partial run missed, its curve's point at the mover's rating.
 */
export function tablePrediction(move: MoveReview, bucket: number): RatingPrediction | undefined {
  return (
    move.moverPrediction ??
    move.humanPredictions?.find((prediction) => prediction.rating === bucket)
  );
}

function roleOf(move: MoveReview, uci: string): PredictionRow["role"] {
  if (uci === move.playedMove) return "played";
  return uci === move.bestMove ? "best" : null;
}

/**
 * `uci`'s probability at each prediction: the full policy's (`fromFull`, stored for the played and
 * best moves), else its share among the prediction's top moves, else 0 (a move Maia hardly plays).
 */
function probabilities(
  predictions: readonly RatingPrediction[],
  uci: string,
  fromFull: (prediction: RatingPrediction) => number | undefined = () => undefined
): number[] {
  return predictions.map(
    (prediction) =>
      fromFull(prediction) ?? prediction.topMoves.find((item) => item.uci === uci)?.prob ?? 0
  );
}

/**
 * The chart's lines over `predictions`' ratings (one prediction per rating, ascending): the move
 * played and the engine's best (one line when they are the same), and Maia's own pick at `marked`
 * (the mover's rating, or the user's level) when it is neither. Null with fewer than two ratings.
 */
export function predictionCurve(
  move: MoveReview,
  predictions: readonly RatingPrediction[],
  marked: number
): PredictionCurve | null {
  const byRating = new Map(predictions.map((prediction) => [prediction.rating, prediction]));
  const sorted = [...byRating.values()].sort((a, b) => a.rating - b.rating);
  if (sorted.length < 2) return null;
  const san = (uci: string) => uciToSan(move.fenBefore, uci) ?? uci;
  const lines: PredictionLine[] = [
    {
      role: "played",
      san: san(move.playedMove),
      probs: probabilities(sorted, move.playedMove, (prediction) => prediction.playedProb)
    }
  ];
  const best = move.bestMove;
  if (best && best !== move.playedMove)
    lines.push({
      role: "best",
      san: san(best),
      probs: probabilities(sorted, best, (prediction) => prediction.bestProb)
    });
  const pick = (byRating.get(marked) ?? move.moverPrediction)?.topMoves[0]?.uci;
  if (pick && roleOf(move, pick) === null)
    lines.push({ role: "maia", san: san(pick), probs: probabilities(sorted, pick) });
  return { ratings: sorted.map((prediction) => prediction.rating), lines };
}

/** A prediction's top moves (the Human moves table), most likely first. */
export function humanMoveRows(
  move: MoveReview,
  prediction: RatingPrediction | undefined
): HumanMoveRow[] {
  return (prediction?.topMoves ?? []).slice(0, TABLE_ROWS).flatMap((item) => {
    const san = uciToSan(move.fenBefore, item.uci);
    return san ? [{ uci: item.uci, san, prob: item.prob, role: roleOf(move, item.uci) }] : [];
  });
}

/** The engine's candidate moves from before the move (`limit` of them), best first. */
export function engineMoveRows(move: MoveReview, limit: number): EngineMoveRow[] {
  return move.topLines.slice(0, Math.min(limit, TABLE_ROWS)).flatMap((line) => {
    const uci = line.pv.at(0);
    const san = uci ? uciToSan(move.fenBefore, uci) : null;
    return uci && san ? [{ uci, san, score: line.scoreWhite, role: roleOf(move, uci) }] : [];
  });
}

/* ---------------------------------------------------------------- chart geometry */

/** Room for the % axis on the left, the moves' names right of the lines, the ratings below. */
const PAD = { left: 34, right: 52, top: 18, bottom: 24 };
/** The marked rating's band: at most this wide, and never wider than this share of a step. */
const BAND_WIDTH = 44;
const BAND_SHARE = 0.6;
/** End labels sit this far right of the last point, at least `LABEL_GAP` apart (11px bold). */
const LABEL_OFFSET = 8;
const LABEL_GAP = 14;
/** A label's baseline sits this far under the middle of its text (11px). */
const LABEL_BASELINE = 4;
/** Rating labels' centres stay this far apart ("2600" in 10.5px mono, and a gap). */
const TICK_LABEL_GAP = 34;
/** Steps (in points) between labelled ratings, the smallest that keeps them apart wins. */
const TICK_LABEL_STRIDES = [1, 2, 4, 5, 10] as const;
/** Points closer than this draw smaller markers (Maia 3's 21 ratings in a narrow panel). */
const DENSE_STEP = 24;

type PredictionPoint = { x: number; y: number };
type PredictionSeries = {
  role: PredictionRole;
  points: PredictionPoint[];
  /** The line through the points, and the area under it down to 0 (SVG paths). */
  path: string;
  area: string;
};
export type PredictionChart = {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  /** Round steps from 0 to the top of the axis. */
  yTicks: Array<{ y: number; label: string }>;
  /** Every rating's column; `label`: its rating is written under the axis (the marked one bold). */
  xTicks: Array<{ x: number; rating: number; marked: boolean; label: boolean }>;
  /** The marked rating, behind the lines (none when Maia wasn't read at it). */
  markBand: { x: number; width: number } | null;
  /** A rating's band (the marked one's, or the hovered one's), as wide as the marked one's. */
  bandWidth: number;
  /** The points are too close for full-size markers. */
  dense: boolean;
  /** Drawn bottom to top: Maia's pick, the move played, then the best (a dot inside a diamond). */
  series: PredictionSeries[];
  /** Each line's move, right of its last point. */
  endLabels: Array<{ role: PredictionRole; x: number; y: number; text: string }>;
};

/** Which lines are drawn over which where they meet (the best's dot fits inside the diamond). */
const DRAW_ORDER: Record<PredictionRole, number> = { maia: 0, played: 1, best: 2 };

/**
 * The y axis for values up to `highest` (shares of the moves): round steps of 10% while the top
 * is at most 30%, else of 25%, up to the first step that holds every value (10% at least).
 */
export function axisTicks(highest: number): { max: number; ticks: number[] } {
  // Whole percents, with a hair of slack so 0.3 (0.30000000000000004) stays 30%.
  const top = Math.ceil(Math.max(0, highest) * 100 - 1e-6);
  const step = top <= 30 ? 10 : 25;
  const max = Math.min(100, Math.max(step, Math.ceil(top / step) * step));
  const ticks: number[] = [];
  for (let value = 0; value <= max; value += step) ticks.push(value / 100);
  return { max: max / 100, ticks };
}

/**
 * Which of `count` columns `step` px apart write their rating: every `stride`-th from the first
 * (the smallest stride whose labels keep {@link TICK_LABEL_GAP} apart), the last, and the marked
 * one, which drops a neighbour too close to it.
 */
export function tickLabels(count: number, step: number, marked: number): boolean[] {
  const stride =
    TICK_LABEL_STRIDES.find((each) => each * step >= TICK_LABEL_GAP) ?? Math.max(1, count - 1);
  const minIndexGap = TICK_LABEL_GAP / Math.max(step, Number.EPSILON);
  return Array.from({ length: count }, (_, index) => {
    if (index === marked) return true;
    const onGrid = index % stride === 0 || index === count - 1;
    return onGrid && (marked < 0 || Math.abs(index - marked) >= minIndexGap);
  });
}

/** The chart for `lines` over `ratings` in a `width` × `height` box, the `marked` rating shaded. */
export function predictionChart(
  lines: readonly PredictionLine[],
  ratings: readonly number[],
  marked: number,
  size: { width: number; height: number }
): PredictionChart {
  const { width, height } = size;
  const plot = {
    left: PAD.left,
    right: Math.max(PAD.left, width - PAD.right),
    top: PAD.top,
    bottom: Math.max(PAD.top, height - PAD.bottom)
  };
  const clamped = lines.map((line) => ({ ...line, probs: line.probs.map(clamp01) }));
  const axis = axisTicks(Math.max(0, ...clamped.flatMap((line) => line.probs)));
  const step = (plot.right - plot.left) / Math.max(1, ratings.length - 1);
  const x = (index: number) => plot.left + index * step;
  const y = (value: number) => plot.top + (1 - value / axis.max) * (plot.bottom - plot.top);

  const series = clamped.map((line) => {
    const points = line.probs.map((value, index) => ({ x: x(index), y: y(value) }));
    const path = linePath(points);
    const first = points[0];
    const last = points[points.length - 1];
    const area = `${path} L${last.x.toFixed(1)},${plot.bottom} L${first.x.toFixed(1)},${plot.bottom} Z`;
    return { role: line.role, points, path, area };
  });
  const markedIndex = ratings.indexOf(marked);
  const bandWidth = Math.min(BAND_WIDTH, step * BAND_SHARE);
  const labelled = tickLabels(ratings.length, step, markedIndex);
  const labels = series.map((line, index) => {
    const last = line.points[line.points.length - 1];
    return { role: line.role, x: last.x + LABEL_OFFSET, text: clamped[index].san };
  });
  const labelYs = spreadLabels(
    series.map((line) => (line.points.at(-1)?.y ?? plot.bottom) + LABEL_BASELINE),
    LABEL_GAP,
    plot.bottom + LABEL_BASELINE
  );
  return {
    width,
    height,
    plot,
    yTicks: axis.ticks.map((value) => ({ y: y(value), label: percent(value) })),
    xTicks: ratings.map((rating, index) => ({
      x: x(index),
      rating,
      marked: index === markedIndex,
      label: labelled[index] ?? false
    })),
    markBand: markedIndex < 0 ? null : { x: x(markedIndex) - bandWidth / 2, width: bandWidth },
    bandWidth,
    dense: step < DENSE_STEP,
    series: [...series].sort((a, b) => DRAW_ORDER[a.role] - DRAW_ORDER[b.role]),
    endLabels: labels.map((label, index) => ({ ...label, y: labelYs[index] }))
  };
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function linePath(points: readonly PredictionPoint[]): string {
  return points
    .map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");
}

/**
 * Label baselines (`ys`, in any order) moved apart so no two are closer than `gap`: each pushed
 * down below the one above it, then the whole stack lifted back if it ran past `lowest`. Same
 * order as `ys`.
 */
export function spreadLabels(ys: readonly number[], gap: number, lowest: number): number[] {
  const order = ys.map((_, index) => index).sort((a, b) => ys[a] - ys[b]);
  const spread = [...ys];
  order.forEach((index, rank) => {
    if (rank) spread[index] = Math.max(ys[index], spread[order[rank - 1]] + gap);
  });
  const last = order.at(-1);
  const overflow = last === undefined ? 0 : Math.max(0, spread[last] - lowest);
  return spread.map((y) => y - overflow);
}

/* ---------------------------------------------------------------- interaction */

/** The column (rating) nearest to `x`, of columns at `xs`. */
export function nearestColumn(x: number, xs: readonly number[]): number {
  let nearest = 0;
  xs.forEach((columnX, index) => {
    if (Math.abs(columnX - x) < Math.abs(xs[nearest] - x)) nearest = index;
  });
  return nearest;
}

/**
 * The column a key moves to from `current` (of `count`): ← → one step (from `start` when none is
 * shown), Home and End the ends; Escape clears (null); undefined for any other key.
 */
export function columnForKey(
  key: string,
  current: number | null,
  count: number,
  start: number
): number | null | undefined {
  const last = count - 1;
  switch (key) {
    case "ArrowLeft":
      return current === null ? start : Math.max(0, current - 1);
    case "ArrowRight":
      return current === null ? start : Math.min(last, current + 1);
    case "Home":
      return 0;
    case "End":
      return last;
    case "Escape":
      return null;
    default:
      return undefined;
  }
}

/** Each line's value at a rating, the most likely first (the tooltip's rows). */
export function columnValues(
  lines: readonly PredictionLine[],
  index: number
): Array<{ role: PredictionRole; san: string; value: number }> {
  return lines
    .map((line) => ({ role: line.role, san: line.san, value: line.probs[index] ?? 0 }))
    .sort((a, b) => b.value - a.value);
}

/** A rating's values as one sentence: "1700: Maia's pick Qe8+ 58%, Played Rd1 3%, Best Qd5 2%". */
export function columnText(
  lines: readonly PredictionLine[],
  ratings: readonly number[],
  index: number
): string {
  const rows = columnValues(lines, index).map(
    (row) => `${PREDICTION_ROLE_NAMES[row.role]} ${row.san} ${percent(row.value)}`
  );
  return `${ratings[index] ?? ""}: ${rows.join(", ")}`;
}
