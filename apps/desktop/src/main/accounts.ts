/**
 * The connected accounts' ratings (main/account-ratings.ts): Lichess or Chess.com fills Settings →
 * Ratings, the one picked while both are connected. Started once on app open.
 */
import { AccountRatings } from "./account-ratings";
import { getChesscomAccountStore, startChesscomRatingSync } from "./chesscom";
import { settingsRepository } from "./db/repositories";
import { broadcast } from "./ipc/broadcast";
import { getLichessAccountStore, startLichessRatingSync } from "./lichess";
import { errorMessage, logger } from "./logger";

let accountRatings: AccountRatings | null = null;

export function getAccountRatings(): AccountRatings {
  accountRatings ??= new AccountRatings({
    picked: () => settingsRepository.getAll().ratingsAccount,
    // The store, not the service: reading it doesn't open Lichess's event stream.
    lichess: () => getLichessAccountStore().status(),
    chesscom: () => getChesscomAccountStore().account(),
    readRatings: () => settingsRepository.getAll().playerRatings,
    writeRatings: (ratings) => {
      settingsRepository.set("playerRatings", ratings);
      broadcast("settings:changed", ["playerRatings"]);
    },
    log: (message, error) =>
      logger.info("settings", message, error === undefined ? "" : errorMessage(error))
  });
  return accountRatings;
}

/** App open: each account's ratings sync starts, handing Settings → Ratings to the one in charge. */
export function startAccountRatingSyncs(): void {
  const ratings = getAccountRatings();
  startLichessRatingSync({
    inCharge: async () => (await ratings.inCharge()) === "lichess",
    onAccountChange: () => void ratings.apply()
  });
  startChesscomRatingSync(() => ratings.apply());
}
