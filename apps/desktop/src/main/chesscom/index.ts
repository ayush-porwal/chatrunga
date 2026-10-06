import { app } from "electron";
import { join } from "node:path";
import { gameRepository } from "../db/repositories";
import { errorMessage, logger } from "../logger";
import { ChesscomAccountStore } from "./account-store";
import { ChesscomService } from "./chesscom-service";
import { ChesscomRatingSync } from "./rating-sync";

let store: ChesscomAccountStore | null = null;
let service: ChesscomService | null = null;
let ratingSync: ChesscomRatingSync | null = null;

/** The saved account (userData/chesscom-account.json). */
export function getChesscomAccountStore(): ChesscomAccountStore {
  store ??= new ChesscomAccountStore(join(app.getPath("userData"), "chesscom-account.json"));
  return store;
}

export function getChesscomService(): ChesscomService {
  service ??= new ChesscomService({
    store: getChesscomAccountStore(),
    games: gameRepository,
    // Chess.com asks API clients to say who they are.
    userAgent: `Chaturanga/${app.getVersion()} (desktop chess app; +https://github.com/ayush-porwal/chatrunga)`
  });
  return service;
}

/**
 * App open: the chess.com account's ratings are read again now and hourly, and Settings → Ratings
 * follows them while chess.com is the account in charge (see rating-sync.ts).
 */
export function startChesscomRatingSync(applyRatings: () => Promise<void>): void {
  if (ratingSync) return;
  const chesscom = getChesscomService();
  const sync = new ChesscomRatingSync({
    refreshAccount: () => chesscom.refreshAccount(),
    applyRatings,
    log: (message, error) =>
      logger.info("chesscom", message, error === undefined ? "" : errorMessage(error))
  });
  chesscom.on("event", (event) => sync.handleEvent(event));
  ratingSync = sync;
  sync.start();
}

/** App quit: stops a connect or an import, if the service was ever used. */
export function shutdownChesscom(): void {
  ratingSync?.stop();
  service?.shutdown();
}
