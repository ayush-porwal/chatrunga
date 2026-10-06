/**
 * Which connected account fills Settings → Ratings, and the handover between them. Lichess and
 * Chess.com each keep their account's ratings in their own store; one fills the ratings at a time:
 * the one picked in Settings while both are connected, else the one connected
 * (`ratingsAccountInCharge`). `apply` brings the ratings in step with the stores (no network): it
 * runs when the pick changes and when an account connects or disconnects.
 */
import type { ChesscomAccount } from "@chaturanga/shared/types/chesscom";
import type { LichessAccount } from "@chaturanga/shared/types/lichess";
import {
  chesscomRatingsByMode,
  lichessRatingsByMode,
  RATING_MODES,
  ratingsAccountInCharge,
  ratingsFromAccount,
  type PlayerRatings,
  type RatingMode,
  type RatingsAccount
} from "@chaturanga/shared/types/ratings";

export type AccountRatingsDeps = {
  /** The account picked in Settings (it applies while both are connected). */
  picked: () => RatingsAccount;
  /** The saved Lichess account (null: none connected). */
  lichess: () => Promise<LichessAccount | null>;
  /** The saved chess.com account (null: none connected). */
  chesscom: () => Promise<ChesscomAccount | null>;
  readRatings: () => PlayerRatings;
  /** Stores the ratings and tells the renderer. */
  writeRatings: (ratings: PlayerRatings) => void;
  now?: () => number;
  log?: (message: string, error?: unknown) => void;
};

/** Whether two sets of ratings say the same (each mode's source and rating; not when synced). */
export function sameRatings(a: PlayerRatings, b: PlayerRatings): boolean {
  return RATING_MODES.every(
    (mode) => a[mode].source === b[mode].source && a[mode].rating === b[mode].rating
  );
}

export class AccountRatings {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly deps: AccountRatingsDeps) {}

  /** The account that fills the ratings now (null: none is connected). */
  async inCharge(): Promise<RatingsAccount | null> {
    const [lichess, chesscom] = await Promise.all([this.deps.lichess(), this.deps.chesscom()]);
    return ratingsAccountInCharge(this.deps.picked(), {
      lichess: Boolean(lichess),
      chesscom: Boolean(chesscom)
    });
  }

  /**
   * Fills the ratings from the account in charge's saved ratings (and gives the other's up). One at
   * a time; a write that changes nothing is skipped. Never rejects: a failure is logged.
   */
  apply(): Promise<void> {
    const run = this.tail.then(() => this.run());
    this.tail = run;
    return run;
  }

  private async run(): Promise<void> {
    try {
      const [lichess, chesscom] = await Promise.all([this.deps.lichess(), this.deps.chesscom()]);
      const account = ratingsAccountInCharge(this.deps.picked(), {
        lichess: Boolean(lichess),
        chesscom: Boolean(chesscom)
      });
      let byMode: Partial<Record<RatingMode, number>> = {};
      if (account === "lichess" && lichess) byMode = lichessRatingsByMode(lichess.perfs);
      else if (account === "chesscom" && chesscom) byMode = chesscomRatingsByMode(chesscom.ratings);
      const current = this.deps.readRatings();
      const next = ratingsFromAccount(
        current,
        account ? { account, byMode } : null,
        this.deps.now?.() ?? Date.now()
      );
      if (!sameRatings(current, next)) this.deps.writeRatings(next);
    } catch (error) {
      this.deps.log?.("ratings couldn't be brought in step with the accounts:", error);
    }
  }
}
