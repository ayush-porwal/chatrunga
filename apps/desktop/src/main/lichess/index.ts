import { app, safeStorage, shell } from "electron";
import { join } from "node:path";
import { gameRepository, settingsRepository } from "../db/repositories";
import { broadcast } from "../ipc/broadcast";
import { errorMessage, logger } from "../logger";
import { LichessAccountStore } from "./account-store";
import { LichessService } from "./lichess-service";
import { LichessRatingSync } from "./rating-sync";

let service: LichessService | null = null;
let ratingSync: LichessRatingSync | null = null;

export function getLichessService(): LichessService {
  if (!service) {
    service = new LichessService({
      store: new LichessAccountStore(
        join(app.getPath("userData"), "lichess-account.json"),
        safeStorage
      ),
      games: gameRepository,
      openExternal: (url) => shell.openExternal(url)
    });
  }
  return service;
}

/**
 * App open: Settings → Ratings follow the connected Lichess account from now on (see
 * rating-sync.ts). A write is announced on `settings:changed`, so open screens read it again.
 */
export function startLichessRatingSync(): void {
  if (ratingSync) return;
  const lichess = getLichessService();
  const sync = new LichessRatingSync({
    refreshAccount: () => lichess.refreshAccount(),
    readRatings: () => settingsRepository.getAll().playerRatings,
    writeRatings: (ratings) => {
      settingsRepository.set("playerRatings", ratings);
      broadcast("settings:changed", ["playerRatings"]);
    },
    log: (message, error) =>
      logger.info("lichess", message, error === undefined ? "" : errorMessage(error))
  });
  lichess.on("event", (event) => sync.handleEvent(event));
  ratingSync = sync;
  sync.start();
}

/** App quit: closes Lichess connections, if the service was ever used. */
export function shutdownLichess(): void {
  ratingSync?.stop();
  service?.shutdown();
}
