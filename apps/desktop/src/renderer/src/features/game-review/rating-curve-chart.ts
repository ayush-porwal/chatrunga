import { MAIA_BUCKETS, type MaiaRatingBucket } from "@chaturanga/shared/schemas/constants";
import type { RatingCurve } from "@chaturanga/shared/schemas";
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
 * Maia's moves at the user's rating beside the engine's, and how often players at each Maia rating
 * play the move played, the best move and Maia's own pick, as lines over the five rating levels.
 */

/** Who a line or a row stands for: the move played, the engine's best, or Maia's pick. */
export type PredictionRole = "played" | "best" | "maia";

export type PredictionLine = {
  role: PredictionRole;
  san: string;
  /** Maia's probability at each rating level (MAIA_BUCKETS order). */
  probs: readonly number[];
};

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

/** Maia's top moves at the user's level and how likely each is. */
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
 * The move's probability at each Maia level, from each level's top moves (a move outside them is
 * one Maia hardly plays: 0).
 */
function levelProbabilities(predictions: readonly RatingPrediction[], uci: string): number[] {
  return MAIA_BUCKETS.map(
    (rating) =>
      predictions
        .find((prediction) => prediction.rating === rating)
        ?.topMoves.find((item) => item.uci === uci)?.prob ?? 0
  );
}

/** The level Maia ran at for the user's bucket, if it did. */
function userLevel(move: MoveReview, bucket: MaiaRatingBucket): RatingPrediction | undefined {
  return move.humanPredictions?.find((prediction) => prediction.rating === bucket);
}

function roleOf(move: MoveReview, uci: string): PredictionRow["role"] {
  if (uci === move.playedMove) return "played";
  return uci === move.bestMove ? "best" : null;
}

/**
 * The chart's lines: the move played and the engine's best (one line when they are the same), and
 * Maia's own pick at the user's level when it is neither.
 */
export function predictionLines(move: MoveReview, curve: RatingCurve): PredictionLine[] {
  const san = (uci: string) => uciToSan(move.fenBefore, uci) ?? uci;
  const lines: PredictionLine[] = [
    { role: "played", san: san(move.playedMove), probs: curve.playedProb }
  ];
  if (move.bestMove && move.bestMove !== move.playedMove)
    lines.push({ role: "best", san: san(move.bestMove), probs: curve.bestProb });
  const pick = userLevel(move, curve.userRatingBucket)?.topMoves[0]?.uci;
  if (pick && roleOf(move, pick) === null) {
    lines.push({
      role: "maia",
      san: san(pick),
      probs: levelProbabilities(move.humanPredictions ?? [], pick)
    });
  }
  return lines;
}

/** Maia's top moves at the user's level, most likely first. */
export function humanMoveRows(move: MoveReview, bucket: MaiaRatingBucket): HumanMoveRow[] {
  return (userLevel(move, bucket)?.topMoves ?? []).slice(0, TABLE_ROWS).flatMap((item) => {
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
/** The user's level's band: at most this wide, and never wider than this share of a step. */
const BAND_WIDTH = 44;
const BAND_SHARE = 0.6;
/** End labels sit this far right of the last point, at least `LABEL_GAP` apart (11px bold). */
const LABEL_OFFSET = 8;
const LABEL_GAP = 14;
/** A label's baseline sits this far under the middle of its text (11px). */
const LABEL_BASELINE = 4;

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
  xTicks: Array<{ x: number; rating: number; user: boolean }>;
  /** The user's level, behind the lines (none when it isn't one of Maia's). */
  userBand: { x: number; width: number } | null;
  /** A level's band (the user's, or the hovered one's), as wide as the user's. */
  bandWidth: number;
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

/** The chart for `lines` in a `width` × `height` box, the user's level marked. */
export function predictionChart(
  lines: readonly PredictionLine[],
  userBucket: MaiaRatingBucket,
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
  const step = (plot.right - plot.left) / (MAIA_BUCKETS.length - 1);
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
  const userIndex = MAIA_BUCKETS.indexOf(userBucket);
  const bandWidth = Math.min(BAND_WIDTH, step * BAND_SHARE);
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
    xTicks: MAIA_BUCKETS.map((rating, index) => ({
      x: x(index),
      rating,
      user: index === userIndex
    })),
    userBand: userIndex < 0 ? null : { x: x(userIndex) - bandWidth / 2, width: bandWidth },
    bandWidth,
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

/** The column (rating level) nearest to `x`, of columns at `xs`. */
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

/** Each line's value at a level, the most likely first (the tooltip's rows). */
export function columnValues(
  lines: readonly PredictionLine[],
  index: number
): Array<{ role: PredictionRole; san: string; value: number }> {
  return lines
    .map((line) => ({ role: line.role, san: line.san, value: line.probs[index] ?? 0 }))
    .sort((a, b) => b.value - a.value);
}

/** A level's values as one sentence: "1700: Maia's pick Qe8+ 58%, Played Rd1 3%, Best Qd5 2%". */
export function columnText(lines: readonly PredictionLine[], index: number): string {
  const rows = columnValues(lines, index).map(
    (row) => `${PREDICTION_ROLE_NAMES[row.role]} ${row.san} ${percent(row.value)}`
  );
  return `${MAIA_BUCKETS[index] ?? ""}: ${rows.join(", ")}`;
}
