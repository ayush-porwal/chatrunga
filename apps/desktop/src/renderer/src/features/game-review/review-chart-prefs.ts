/**
 * Whether the review's charts are folded (all of them, or one strip: Winning chances, Difficulty or Move times) and
 * the height the charts area
 * was dragged to, remembered on this machine (localStorage) like the window layout: a way of
 * reading the review, not a chess setting. A missing, unreadable or invalid value falls back to
 * the default (open charts, the default height).
 */

import { readLocalPref, writeLocalPref } from "@/lib/local-prefs";

/** The whole charts section ("charts"), or one of its strips. */
export type FoldableChart = "charts" | "win" | "difficulty" | "times";

const KEYS: Record<FoldableChart, string> = {
  charts: "chaturanga.reviewCharts.collapsed",
  win: "chaturanga.reviewCharts.winCollapsed",
  difficulty: "chaturanga.reviewCharts.difficultyCollapsed",
  times: "chaturanga.reviewCharts.timesCollapsed"
};

export function loadChartCollapsed(chart: FoldableChart): boolean {
  return readLocalPref(KEYS[chart]) === "1";
}

export function saveChartCollapsed(chart: FoldableChart, collapsed: boolean): void {
  writeLocalPref(KEYS[chart], collapsed ? "1" : "0");
}

const HEIGHT_KEY = "chaturanga.reviewCharts.height";
/** Taller than any panel; a stored height beyond it is not one this app wrote. */
const MAX_STORED_HEIGHT = 10_000;

/** The charts area's height the splitter was dragged to; null: the default for the views shown. */
export function loadChartsHeight(): number | null {
  const raw = readLocalPref(HEIGHT_KEY);
  if (raw === null) return null;
  const height = Number(raw);
  return Number.isFinite(height) && height > 0 && height <= MAX_STORED_HEIGHT ? height : null;
}

export function saveChartsHeight(height: number | null): void {
  writeLocalPref(HEIGHT_KEY, height === null ? null : String(Math.round(height)));
}
