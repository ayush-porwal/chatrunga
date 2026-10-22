/*
 * Chart primitives shared by the app's SVG charts (Game review's Human prediction, the Puzzles
 * rating chart): the pointer's nearest column, keyboard stepping over columns, and round axis
 * ticks. The charts draw themselves in SVG with the design tokens (dashed `stroke-line` grid,
 * 10px mono tick labels in `fill-fg-subtle`, an accent line over a fading fill).
 */

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

/**
 * Round ticks covering `min`–`max` (at least `count`-ish of them): steps of 1, 2, 2.5 or 5 times a
 * power of ten, the axis widened out to whole steps. A flat range is padded by one step each way.
 */
export function niceTicks(
  min: number,
  max: number,
  count = 4
): { min: number; max: number; ticks: number[] } {
  let low = Math.min(min, max);
  let high = Math.max(min, max);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return { min: 0, max: 1, ticks: [0, 1] };
  const step = niceStep((high - low || Math.abs(high) || 1) / Math.max(1, count));
  if (high === low) {
    low -= step;
    high += step;
  }
  const start = Math.floor(low / step) * step;
  const end = Math.ceil(high / step) * step;
  const ticks: number[] = [];
  // Rounded to the step's decimals, so 0.1 steps don't drift (0.30000000000000004).
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  for (let value = start; value <= end + step / 2; value += step)
    ticks.push(Number(value.toFixed(decimals)));
  return { min: start, max: ticks.at(-1) ?? end, ticks };
}

/**
 * The round step nearest above `raw`: 1, 2, 2.5 or 5 × 10ⁿ, or with `integer` 1, 2 or 5 × 10ⁿ and
 * at least 1 (for counts, such as puzzle numbers).
 */
export function niceStep(raw: number, integer = false): number {
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const steps = integer ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  const nice = (steps.find((step) => fraction <= step) ?? 10) * power;
  return integer ? Math.max(1, Math.round(nice)) : nice;
}
