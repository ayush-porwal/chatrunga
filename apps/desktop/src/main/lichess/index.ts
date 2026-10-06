import { app, safeStorage, shell } from "electron";
import { join } from "node:path";
import { gameRepository, settingsRepository } from "../db/repositories";
import { broadcast } from "../ipc/broadcast";
import { errorMessage, logger } from "../logger";
import { LichessAccountStore } from "./account-store";
import { LichessService } from "./lichess-service";
import { LichessRatingSync } from "./rating-sync";

let store: LichessAccountStore | null = null;
let service: LichessService | null = null;
let ratingSync: LichessRatingSync | null = null;

/** The saved account and token (userData/lichess-account.json). */
export function getLichessAccountStore(): LichessAccountStore {
  store ??= new LichessAccountStore(
    join(app.getPath("userData"), "lichess-account.json"),
    safeStorage
  );
  return store;
}

export function getLichessService(): LichessService {
  if (!service) {
    service = new LichessService({
      store: getLichessAccountStore(),
      games: gameRepository,
      openExternal: (url) => shell.openExternal(url)
    });
  }
  return service;
}

/**
 * App open: Settings → Ratings follow the connected Lichess account from now on, while it is the
 * account in charge of them (see rating-sync.ts). A write is announced on `settings:changed`, so
 * open screens read it again.
 */
export function startLichessRatingSync(accounts: {
  /** Whether Lichess fills the ratings now (Chess.com may instead, see account-ratings.ts). */
  inCharge: () => Promise<boolean>;
  /**
   * An account connected, disconnected or was signed out: the ratings are handed over to the one
   * in charge.
   */
  onAccountChange: () => void;
}): void {
  if (ratingSync) return;
  const lichess = getLichessService();
  const sync = new LichessRatingSync({
    refreshAccount: () => lichess.refreshAccount(),
    inCharge: accounts.inCharge,
    readRatings: () => settingsRepository.getAll().playerRatings,
    writeRatings: (ratings) => {
      settingsRepository.set("playerRatings", ratings);
      broadcast("settings:changed", ["playerRatings"]);
    },
    log: (message, error) =>
      logger.info("lichess", message, error === undefined ? "" : errorMessage(error))
  });
  // The account (and whether Lichess still accepts it) last handed over for.
  let handedOver: string | undefined;
  lichess.on("event", (event) => {
    sync.handleEvent(event);
    if (event.type !== "status") return;
    const { account, tokenRejected } = event.status;
    const key = account ? `${account.id}:${tokenRejected}` : "";
    if (key === handedOver) return;
    handedOver = key;
    accounts.onAccountChange();
  });
  ratingSync = sync;
  sync.start();
}

/** App quit: closes Lichess connections, if the service was ever used. */
export function shutdownLichess(): void {
  ratingSync?.stop();
  service?.shutdown();
}
