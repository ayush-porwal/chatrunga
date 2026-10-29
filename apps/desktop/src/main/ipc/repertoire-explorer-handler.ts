import { ipcMain } from "electron";
import { asId } from "./fields";
import { repertoireExplorer } from "../repertoire-explorer";
import {
  parseExplorerMaiaInput,
  parseExplorerPositionInput,
  parseRepertoireIds
} from "./validate-repertoire-explorer";

/**
 * Study's explorer (the user's games and Maia at a position) and the repertoire health check: its
 * flags, Insights' summaries, and the queue (its changes go out on
 * `repertoireExplorer:healthProgress`). Inputs are parsed first; the explorer
 * (main/repertoire-explorer) loads after startup.
 */
export function registerRepertoireExplorerIpc(): void {
  ipcMain.handle("repertoireExplorer:games", async (_event, input: unknown) => {
    const parsed = parseExplorerPositionInput(input);
    return (await repertoireExplorer()).games(parsed);
  });
  ipcMain.handle("repertoireExplorer:maiaMoves", async (_event, input: unknown) => {
    const parsed = parseExplorerMaiaInput(input);
    return (await repertoireExplorer()).maiaMoves(parsed);
  });
  ipcMain.handle("repertoireExplorer:healthFlags", async (_event, repertoireId: unknown) => {
    const id = asId(repertoireId, "repertoireId");
    return (await repertoireExplorer()).healthRepository.flags(id);
  });
  ipcMain.handle("repertoireExplorer:healthSummaries", async () =>
    (await repertoireExplorer()).healthRepository.summaries()
  );
  ipcMain.handle("repertoireExplorer:healthStatus", async () =>
    (await repertoireExplorer()).health.status()
  );
  ipcMain.handle("repertoireExplorer:checkHealth", async (_event, repertoireIds: unknown) => {
    const ids = parseRepertoireIds(repertoireIds);
    return (await repertoireExplorer()).health.check(ids);
  });
  ipcMain.handle("repertoireExplorer:pauseHealth", async () =>
    (await repertoireExplorer()).health.pause()
  );
  ipcMain.handle("repertoireExplorer:resumeHealth", async () =>
    (await repertoireExplorer()).health.resume()
  );
  ipcMain.handle("repertoireExplorer:cancelHealth", async () =>
    (await repertoireExplorer()).health.cancel()
  );
}
