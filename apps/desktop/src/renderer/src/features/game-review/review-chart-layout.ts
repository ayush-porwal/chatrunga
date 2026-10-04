/**
 * The review charts' vertical layout: the fixed rows (splitter, header, fold labels, axis), the
 * charts area's default height for the views shown, the clamp on the height the user drags the
 * splitter to, and how the rest of that height is shared by the views: equally among winning
 * chances and the open strips (Difficulty, Move times), an absent or folded strip's share going to
 * the others, every view keeping its minimum.
 */

/** The splitter's hit area along the top edge of the charts. */
export const SPLITTER_HEIGHT = 8;
/** The header (title and key-insight controls, 28 px buttons) and the space under it. */
const HEADER_HEIGHT = 32;
/** Space between two rows of the views. */
const GAP = 4;
/** A folding strip's label row. */
const TOGGLE_HEIGHT = 20;
/** A one-line note in a strip's place (the Maia prompt, no evaluations yet). */
const PROMPT_HEIGHT = 16;
export const AXIS_HEIGHT = 13;

/** Winning chances: a band for the phase labels over the plot, and room under it for a ringed dot at 0%. */
export const WIN_TOP = 13;
const WIN_BOTTOM = 6;
/** A strip's plot sits this far inside its view, top and bottom. */
export const STRIP_INSET = 2;

/** Each view's share of the height: equal. */
const WIN_WEIGHT = 1;
const STRIP_WEIGHT = 1;
/** The default height gives each open view this much (one alone a little more). */
const VIEW_DEFAULT = 80;
const WIN_ALONE_DEFAULT = 112;
/** The views' minimum heights. */
export const WIN_MIN = 100;
export const STRIP_MIN = 44;

/** The charts never get lower than this: the winning-chances view stays readable. */
export const CHARTS_MIN_HEIGHT = 120;
/** The panel content above the charts keeps at least this much. */
export const CONTENT_MIN_HEIGHT = 160;
/** One arrow-key step of the splitter. */
export const SPLITTER_STEP = 16;

export type ChartsLayout = {
  /** "empty": open, but the game has no evaluations (unreviewed), so a one-line note shows. */
  win: "open" | "folded" | "empty";
  difficulty: "open" | "folded" | "prompt" | "none";
  times: "open" | "folded" | "none";
};

/** The views' heights in pixels (null for one that isn't drawn: folded or absent). */
export type ViewHeights = { win: number | null; difficulty: number | null; times: number | null };

export type OpenViews = { win: boolean; difficulty: boolean; times: boolean };

export function openViews(layout: ChartsLayout): OpenViews {
  return {
    win: layout.win === "open",
    difficulty: layout.difficulty === "open",
    times: layout.times === "open"
  };
}

function openCount(open: OpenViews): number {
  return Number(open.win) + Number(open.difficulty) + Number(open.times);
}

/**
 * The rows that don't grow: splitter, header, each strip's label (or the Maia prompt), the move
 * axis under the last open strip, and the gaps between rows.
 */
function fixedHeight(layout: ChartsLayout): number {
  const views = openCount(openViews(layout));
  const rows: number[] = [TOGGLE_HEIGHT];
  if (layout.win === "empty") rows.push(PROMPT_HEIGHT);
  if (layout.difficulty === "open" || layout.difficulty === "folded") rows.push(TOGGLE_HEIGHT);
  else if (layout.difficulty === "prompt") rows.push(PROMPT_HEIGHT);
  if (layout.times !== "none") rows.push(TOGGLE_HEIGHT);
  if (views) rows.push(AXIS_HEIGHT);
  const gaps = (rows.length + views - 1) * GAP;
  return SPLITTER_HEIGHT + HEADER_HEIGHT + rows.reduce((sum, row) => sum + row, 0) + gaps;
}

/** The charts area's height with nothing set: every open view at its usual size. */
export function defaultChartsHeight(layout: ChartsLayout): number {
  const count = openCount(openViews(layout));
  const views = count ? Math.max(WIN_ALONE_DEFAULT, count * VIEW_DEFAULT) : 0;
  return fixedHeight(layout) + views;
}

/**
 * Shares `space` pixels equally between the open views (winning chances, Difficulty, Move times),
 * each at least its minimum: a view whose share falls short takes its minimum and the rest is
 * shared again by the others. Too little space for every minimum leaves each at its minimum (the
 * charts scroll). A folded or absent view gets nothing; its share goes to the others.
 */
export function splitViewHeights(space: number, open: OpenViews): ViewHeights {
  const views = [
    ...(open.win ? [{ key: "win", weight: WIN_WEIGHT, min: WIN_MIN }] : []),
    ...(open.difficulty ? [{ key: "difficulty", weight: STRIP_WEIGHT, min: STRIP_MIN }] : []),
    ...(open.times ? [{ key: "times", weight: STRIP_WEIGHT, min: STRIP_MIN }] : [])
  ];
  const sizes = new Map<string, number>();
  let free = [...views];
  let left = Math.max(0, space);
  // Pin a view at its minimum whenever its share would fall short, then share the rest again.
  while (free.length) {
    const weight = free.reduce((sum, view) => sum + view.weight, 0);
    const short = free.filter((view) => (left * view.weight) / weight < view.min);
    if (!short.length) {
      for (const view of free) sizes.set(view.key, Math.floor((left * view.weight) / weight));
      break;
    }
    for (const view of short) {
      sizes.set(view.key, view.min);
      left -= view.min;
    }
    free = free.filter((view) => !short.includes(view));
  }
  // Rounding leftovers go to the first open view, so the views fill the space exactly.
  const first = views[0];
  if (first) {
    const used = [...sizes.values()].reduce((sum, size) => sum + size, 0);
    sizes.set(first.key, (sizes.get(first.key) ?? 0) + Math.max(0, Math.floor(space) - used));
  }
  return {
    win: sizes.get("win") ?? null,
    difficulty: sizes.get("difficulty") ?? null,
    times: sizes.get("times") ?? null
  };
}

/**
 * The views' heights in the views area as laid out: `container` is its height, `chrome` the
 * measured heights of its other rows (strip labels, notes, the move axis), `gap` the space between
 * rows. The open views share exactly what is left, so views and chrome fill the container; only
 * when that falls below the views' minimums do they overflow (and the area scrolls).
 */
export function fitViewHeights(input: {
  container: number;
  chrome: readonly number[];
  open: OpenViews;
  gap: number;
}): ViewHeights {
  const rows = input.chrome.length + openCount(input.open);
  const chrome = input.chrome.reduce((sum, row) => sum + row, 0);
  return splitViewHeights(input.container - chrome - Math.max(0, rows - 1) * input.gap, input.open);
}

/**
 * The views' heights in a charts area `height` high, from the rows' usual sizes: an estimate
 * until the views area is measured ({@link fitViewHeights}).
 */
export function viewHeights(height: number, layout: ChartsLayout): ViewHeights {
  return splitViewHeights(height - fixedHeight(layout), openViews(layout));
}

/** The winning-chances plot inside its view. */
export function winPlotHeight(view: number): number {
  return view - WIN_TOP - WIN_BOTTOM;
}

/** A strip's plot inside its view. */
export function stripPlotHeight(view: number): number {
  return view - 2 * STRIP_INSET;
}

/**
 * The tallest the charts may be: as tall as they are now plus what the content above has beyond
 * its minimum (`content`: its current height). Null when the panel can't be measured.
 */
export function chartsMaxHeight(content: number | null, charts: number): number | null {
  return content === null ? null : charts + content - CONTENT_MIN_HEIGHT;
}

/**
 * A charts height within bounds: no lower than {@link CHARTS_MIN_HEIGHT}, and no taller than `max`
 * (from {@link chartsMaxHeight}) unless that is below the minimum, which wins.
 */
export function clampChartsHeight(height: number, max: number | null): number {
  const capped = max === null ? height : Math.min(height, max);
  return Math.round(Math.max(CHARTS_MIN_HEIGHT, capped));
}

/**
 * The charts area's height. Filling (the Review section above is folded, so the charts own the
 * panel down to the move navigation): the height measured for them, whatever the splitter was set
 * to; the views split it and scroll below their minimums. Otherwise the splitter's height (or the
 * default for the views shown), clamped by {@link clampChartsHeight}.
 */
export function resolveChartsHeight(input: {
  fill: boolean;
  /** The charts area's laid-out height; null before it is measured. */
  measured: number | null;
  /** The splitter's height; null when it was never set or was reset. */
  stored: number | null;
  /** From {@link chartsMaxHeight}. */
  max: number | null;
  layout: ChartsLayout;
}): number {
  if (input.fill) return Math.round(input.measured ?? defaultChartsHeight(input.layout));
  return clampChartsHeight(input.stored ?? defaultChartsHeight(input.layout), input.max);
}
