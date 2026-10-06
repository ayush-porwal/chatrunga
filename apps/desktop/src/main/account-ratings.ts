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
  applyAccountRatings,
  chesscomRatingsByMode,
  lichessRatingsByMode,
  RATING_MODES,
  ratingsAccountInCharge,
  releaseAccountRatings,
  type PlayerRatings,
  type RatingsAccount
} from "@chaturanga/shared/types/ratings";

export type AccountRatingsDeps = {
  /** The account picked in Settings (it applies while both are connected). */
  picked: () => RatingsAccount;
  /**
   * The saved Lichess account (null: none connected), and whether Lichess signed it out (its token
   * was refused: it can't fill the ratings, but they stay until it reconnects or disconnects).
   */
  lichess: () => Promise<{ account: LichessAccount | null; tokenRejected: boolean }>;
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

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** The account that fills the ratings now (null: none is connected and signed in). */
  async inCharge(): Promise<RatingsAccount | null> {
    return (await this.accounts()).inCharge;
  }

  private async accounts() {
    const [lichess, chesscom] = await Promise.all([this.deps.lichess(), this.deps.chesscom()]);
    const usableLichess = lichess.tokenRejected ? null : lichess.account;
    return {
      lichess: usableLichess,
      /** A signed-out Lichess account: its ratings stay put while no other account takes over. */
      lichessSignedOut: Boolean(lichess.account && lichess.tokenRejected),
      chesscom,
      inCharge: ratingsAccountInCharge(this.deps.picked(), {
        lichess: Boolean(usableLichess),
        chesscom: Boolean(chesscom)
      })
    };
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
      const { lichess, lichessSignedOut, chesscom, inCharge } = await this.accounts();
      const current = this.deps.readRatings();
      let next: PlayerRatings;
      if (inCharge === "lichess" && lichess) {
        next = applyAccountRatings(
          current,
          "lichess",
          lichessRatingsByMode(lichess.perfs),
          this.now()
        );
      } else if (inCharge === "chesscom" && chesscom) {
        next = applyAccountRatings(
          current,
          "chesscom",
          chesscomRatingsByMode(chesscom.ratings),
          this.now()
        );
      } else {
        // None in charge: synced values stay, typed-in, but a signed-out Lichess account keeps its
        // own (as before Chess.com: they stay read-only until it reconnects or disconnects).
        next = releaseAccountRatings(current, "chesscom");
        if (!lichessSignedOut) next = releaseAccountRatings(next, "lichess");
      }
      if (!sameRatings(current, next)) this.deps.writeRatings(next);
    } catch (error) {
      this.deps.log?.("ratings couldn't be brought in step with the accounts:", error);
    }
  }
}
