import { ipcMain } from "electron";
import type { InsightsWeakSpotSummary } from "@chaturanga/shared/types/repertoire-insights";
import { getChesscomAccountStore } from "../chesscom";
import { getLichessAccountStore } from "../lichess";
import { repertoireInsights } from "../repertoire-insights";
import {
  parseInsightsFilters,
  parseInsightsGamesQuery,
  parseInsightsReportQuery
} from "./validate-repertoire-insights";

/** Whether Lichess or Chess.com is connected (weak spots come from their games). */
async function accountConnected(): Promise<boolean> {
  const [lichess, chesscom] = await Promise.all([
    getLichessAccountStore()
      .status()
      .then((status) => status.account !== null)
      .catch(() => false),
    getChesscomAccountStore()
      .account()
      .then((account) => account !== null)
      .catch(() => false)
  ]);
  return lichess || chesscom;
}

/**
 * Repertoire Insights: the report, the games list and the saved filters (read from the stored
 * comparisons), and the comparer's status (its changes go out on `repertoireInsights:progress`).
 * Inputs are parsed first; the comparer's module (main/repertoire-insights) loads after startup.
 */
export function registerRepertoireInsightsIpc(): void {
  ipcMain.handle("repertoireInsights:report", async (_event, query: unknown) => {
    const { lineMove } = parseInsightsReportQuery(query);
    return (await repertoireInsights()).insightsReport(lineMove);
  });
  ipcMain.handle("repertoireInsights:games", async (_event, query: unknown) => {
    const parsed = parseInsightsGamesQuery(query);
    return (await repertoireInsights()).insightsGamesPage(parsed);
  });
  ipcMain.handle("repertoireInsights:filters", async () =>
    (await repertoireInsights()).insightsRepository.filters()
  );
  ipcMain.handle("repertoireInsights:setFilters", async (_event, filters: unknown) => {
    const parsed = parseInsightsFilters(filters);
    return (await repertoireInsights()).insightsRepository.setFilters(parsed);
  });
  ipcMain.handle("repertoireInsights:status", async () =>
    (await repertoireInsights()).startRepertoireInsights().status()
  );
  ipcMain.handle("repertoireInsights:weakSpots", async (): Promise<InsightsWeakSpotSummary> => {
    const spots = (await repertoireInsights()).weakSpotPositions();
    return {
      positions: spots.length,
      games: spots.reduce((sum, spot) => sum + spot.games, 0),
      accounts: await accountConnected()
    };
  });
}
