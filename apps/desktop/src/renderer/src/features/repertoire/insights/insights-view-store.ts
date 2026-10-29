import { create } from "zustand";
import {
  DEFAULT_INSIGHTS_LINE_MOVE,
  type InsightsGamesQuery
} from "@chaturanga/shared/types/repertoire-insights";

/**
 * How Insights was left: the report's line move and the Games card's filters and page, kept for
 * the app's session so Back to Insights (after Review game) or Back to the hub shows it as it was.
 */
export const useInsightsViewStore = create<{
  lineMove: number;
  gamesQuery: InsightsGamesQuery;
  setLineMove: (lineMove: number) => void;
  setGamesQuery: (gamesQuery: InsightsGamesQuery) => void;
}>((set) => ({
  lineMove: DEFAULT_INSIGHTS_LINE_MOVE,
  gamesQuery: { page: 0 },
  setLineMove: (lineMove) => set({ lineMove }),
  setGamesQuery: (gamesQuery) => set({ gamesQuery })
}));
