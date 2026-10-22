import type { PuzzleRatingPoint, PuzzleThemeStat } from "@chaturanga/shared/types/puzzle-rating";
import { niceStep, niceTicks } from "@/lib/chart";
import { formatPuzzleTag } from "./puzzle-set";

/*
 * The Puzzles page's charts (PuzzleRatingChart, PuzzleThemeChart): the rating after each recent
 * rated puzzle as a line over the puzzles' numbers, and each theme's share solved as a bar.
 */

/** Room for the rating axis on the left and the puzzle numbers below. */
const PAD = { left: 40, right: 12, top: 12, bottom: 24 };
/** Puzzle-number labels at least this far apart ("1250" in 10px mono, and a gap). */
const X_LABEL_GAP = 64;

export type RatingChartPoint = {
  x: number;
  y: number;
  /** Rounded, as the page shows ratings. */
  rating: number;
  /** The puzzle's number among all the solver's rated puzzles (1 = the first ever). */
  number: number;
  at: number;
};

export type RatingChart = {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  yTicks: Array<{ y: number; label: string }>;
  xTicks: Array<{ x: number; label: string }>;
  points: RatingChartPoint[];
  /** The line through the points, and the area under it down to the axis (SVG paths). */
  path: string;
  area: string;
};

/**
 * The number of the first of `shown` recent rated puzzles when `ratedCount` are rated in all (the
 * history keeps only the latest ones).
 */
export function firstPuzzleNumber(ratedCount: number, shown: number): number {
  return Math.max(1, ratedCount - shown + 1);
}

/** The change from the first to the latest of `history` (null with fewer than two). */
export function ratingChange(history: readonly PuzzleRatingPoint[]): number | null {
  const first = history.at(0);
  const latest = history.at(-1);
  if (!first || !latest || history.length < 2) return null;
  return Math.round(latest.rating) - Math.round(first.rating);
}

/**
 * The line chart of `history` in a `width` × `height` box: ratings on round ticks (the axis padded
 * out to them), puzzle numbers (from `firstNumber`) on whole steps that keep their labels apart.
 * Null with fewer than two points: one rating is no line.
 */
export function ratingChart(
  history: readonly PuzzleRatingPoint[],
  firstNumber: number,
  size: { width: number; height: number }
): RatingChart | null {
  if (history.length < 2) return null;
  const { width, height } = size;
  const plot = {
    left: PAD.left,
    right: Math.max(PAD.left + 1, width - PAD.right),
    top: PAD.top,
    bottom: Math.max(PAD.top + 1, height - PAD.bottom)
  };
  const ratings = history.map((point) => Math.round(point.rating));
  const axis = niceTicks(Math.min(...ratings), Math.max(...ratings), 4);
  const lastNumber = firstNumber + history.length - 1;
  const x = (number: number) =>
    plot.left + ((number - firstNumber) / (lastNumber - firstNumber)) * (plot.right - plot.left);
  const y = (rating: number) =>
    plot.top + (1 - (rating - axis.min) / (axis.max - axis.min)) * (plot.bottom - plot.top);

  const points = history.map((point, index) => ({
    x: x(firstNumber + index),
    y: y(ratings[index]),
    rating: ratings[index],
    number: firstNumber + index,
    at: point.at
  }));
  const path = points
    .map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");
  const first = points[0];
  const last = points[points.length - 1];
  const area = `${path} L${last.x.toFixed(1)},${plot.bottom} L${first.x.toFixed(1)},${plot.bottom} Z`;

  const labels = Math.max(2, Math.floor((plot.right - plot.left) / X_LABEL_GAP));
  const step = niceStep((lastNumber - firstNumber) / labels, true);
  const xTicks: RatingChart["xTicks"] = [];
  for (let number = Math.ceil(firstNumber / step) * step; number <= lastNumber; number += step)
    xTicks.push({ x: x(number), label: String(number) });

  return {
    width,
    height,
    plot,
    yTicks: axis.ticks.map((value) => ({ y: y(value), label: String(value) })),
    xTicks,
    points,
    path,
    area
  };
}

/** A point read out (the slider's value, the tooltip): "Puzzle 245: 1523, 12 Oct 2026". */
export function pointText(point: Pick<RatingChartPoint, "number" | "rating" | "at">): string {
  return `Puzzle ${point.number}: ${point.rating}, ${formatDay(point.at)}`;
}

export function formatDay(at: number): string {
  return new Date(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

export type ThemeRow = PuzzleThemeStat & {
  label: string;
  /** Share of its rated puzzles solved, 0–1. */
  share: number;
};

/** The themes as the chart lists them: the most played first (then by name), with their share solved. */
export function themeRows(stats: readonly PuzzleThemeStat[]): ThemeRow[] {
  return stats
    .filter((stat) => stat.attempts > 0)
    .map((stat) => ({
      ...stat,
      label: formatPuzzleTag(stat.theme),
      share: Math.min(1, Math.max(0, stat.solved / stat.attempts))
    }))
    .sort((a, b) => b.attempts - a.attempts || a.theme.localeCompare(b.theme));
}

/** The Themes filter with `theme` added, or taken out when it is already in. */
export function toggleTheme(selected: readonly string[], theme: string): string[] {
  return selected.includes(theme)
    ? selected.filter((item) => item !== theme)
    : [...selected, theme];
}
