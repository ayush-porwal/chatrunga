/**
 * Whether the review's charts are folded (all of them, or one strip: Winning chances, Difficulty or Move times) and
 * the height the charts area
 * was dragged to, remembered on this machine (localStorage) like the window layout: a way of
 * reading the review, not a chess setting. A missing, unreadable or invalid value falls back to
 * the default (open charts, the default height).
 */

/** The whole charts section ("charts"), or one of its strips. */
export type FoldableChart = "charts" | "win" | "difficulty" | "times";

const KEYS: Record<FoldableChart, string> = {
  charts: "chaturanga.reviewCharts.collapsed",
  win: "chaturanga.reviewCharts.winCollapsed",
  difficulty: "chaturanga.reviewCharts.difficultyCollapsed",
  times: "chaturanga.reviewCharts.timesCollapsed"
};

function storage(): Storage | null {
  // Storage access throws where it is blocked (a sandboxed or opaque origin).
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadChartCollapsed(chart: FoldableChart): boolean {
  try {
    return storage()?.getItem(KEYS[chart]) === "1";
  } catch {
    return false;
  }
}

export function saveChartCollapsed(chart: FoldableChart, collapsed: boolean): void {
  try {
    storage()?.setItem(KEYS[chart], collapsed ? "1" : "0");
  } catch {
    // Full or blocked storage: the choice still applies for this session.
  }
}

const HEIGHT_KEY = "chaturanga.reviewCharts.height";
/** Taller than any panel; a stored height beyond it is not one this app wrote. */
const MAX_STORED_HEIGHT = 10_000;

/** The charts area's height the splitter was dragged to; null: the default for the views shown. */
export function loadChartsHeight(): number | null {
  try {
    const raw = storage()?.getItem(HEIGHT_KEY) ?? null;
    if (raw === null) return null;
    const height = Number(raw);
    return Number.isFinite(height) && height > 0 && height <= MAX_STORED_HEIGHT ? height : null;
  } catch {
    return null;
  }
}

export function saveChartsHeight(height: number | null): void {
  try {
    const store = storage();
    if (height === null) store?.removeItem(HEIGHT_KEY);
    else store?.setItem(HEIGHT_KEY, String(Math.round(height)));
  } catch {
    // Full or blocked storage: the height still applies for this session.
  }
}
