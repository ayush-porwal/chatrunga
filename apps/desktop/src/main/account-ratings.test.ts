import { describe, expect, it } from "vitest";
import type { ChesscomAccount } from "@chaturanga/shared/types/chesscom";
import type { LichessAccount } from "@chaturanga/shared/types/lichess";
import {
  setManualRating,
  uniformRatings,
  type PlayerRatings,
  type RatingsAccount
} from "@chaturanga/shared/types/ratings";
import { AccountRatings } from "./account-ratings";

const NOW = 1_800_000_000_000;

const LICHESS: LichessAccount = {
  id: "ayushp",
  username: "ayushp",
  title: null,
  perfs: {
    bullet: { rating: 1689, games: 10, provisional: false },
    blitz: { rating: 1741, games: 10, provisional: false },
    rapid: { rating: 1820, games: 10, provisional: false },
    classical: { rating: 1900, games: 3, provisional: true }
  },
  connectedAt: 1,
  lastSyncAt: null
};

const CHESSCOM: ChesscomAccount = {
  id: "ayush_p64",
  username: "ayush_p64",
  title: null,
  ratings: { rapid: 1684, blitz: 1662, bullet: 1490, daily: 1550 },
  connectedAt: 1,
  lastSyncAt: null
};

function harness(start: PlayerRatings = uniformRatings(1500)) {
  const state = {
    picked: "lichess" as RatingsAccount,
    lichess: null as LichessAccount | null,
    lichessSignedOut: false,
    chesscom: null as ChesscomAccount | null,
    ratings: start,
    writes: 0
  };
  const accounts = new AccountRatings({
    picked: () => state.picked,
    lichess: async () => ({ account: state.lichess, tokenRejected: state.lichessSignedOut }),
    chesscom: async () => state.chesscom,
    readRatings: () => state.ratings,
    writeRatings: (ratings) => {
      state.writes += 1;
      state.ratings = ratings;
    },
    now: () => NOW
  });
  return { state, accounts };
}

describe("AccountRatings", () => {
  it("fills the ratings from chess.com when only it is connected: Daily is Correspondence", async () => {
    const { state, accounts } = harness(setManualRating(uniformRatings(1500), "classical", 1600));
    state.chesscom = CHESSCOM;
    expect(await accounts.inCharge()).toBe("chesscom");
    await accounts.apply();
    expect(state.ratings).toEqual({
      bullet: { source: "chesscom", rating: 1490, syncedAt: NOW },
      blitz: { source: "chesscom", rating: 1662, syncedAt: NOW },
      rapid: { source: "chesscom", rating: 1684, syncedAt: NOW },
      // Chess.com has no classical rating: the typed one stays (and stays editable).
      classical: { source: "manual", rating: 1600 },
      correspondence: { source: "chesscom", rating: 1550, syncedAt: NOW }
    });
  });

  it("follows the picked account while both are connected, handing every mode over", async () => {
    const { state, accounts } = harness();
    state.lichess = LICHESS;
    state.chesscom = CHESSCOM;
    await accounts.apply();
    expect(state.ratings.classical).toEqual({ source: "lichess", rating: 1900, syncedAt: NOW });
    expect(state.ratings.rapid).toEqual({ source: "lichess", rating: 1820, syncedAt: NOW });

    state.picked = "chesscom";
    expect(await accounts.inCharge()).toBe("chesscom");
    await accounts.apply();
    expect(state.ratings.rapid).toEqual({ source: "chesscom", rating: 1684, syncedAt: NOW });
    // Lichess's classical rating stays, typed-in: chess.com has none to give.
    expect(state.ratings.classical).toEqual({ source: "manual", rating: 1900 });
  });

  it("falls back to the other account when the picked one isn't connected", async () => {
    const { state, accounts } = harness();
    state.picked = "chesscom";
    state.lichess = LICHESS;
    expect(await accounts.inCharge()).toBe("lichess");
    await accounts.apply();
    expect(state.ratings.blitz).toEqual({ source: "lichess", rating: 1741, syncedAt: NOW });
  });

  it("keeps the last values as typed-in ones once no account is connected", async () => {
    const { state, accounts } = harness();
    state.chesscom = CHESSCOM;
    await accounts.apply();
    state.chesscom = null;
    expect(await accounts.inCharge()).toBeNull();
    await accounts.apply();
    expect(state.ratings.rapid).toEqual({ source: "manual", rating: 1684 });
    expect(state.ratings.correspondence).toEqual({ source: "manual", rating: 1550 });
  });

  it("hands a signed-out Lichess account's ratings to chess.com, else keeps them", async () => {
    const { state, accounts } = harness();
    state.lichess = LICHESS;
    await accounts.apply();
    // Lichess refused its token: with nothing else connected, its values stay as they were.
    state.lichessSignedOut = true;
    expect(await accounts.inCharge()).toBeNull();
    await accounts.apply();
    expect(state.ratings.rapid).toEqual({ source: "lichess", rating: 1820, syncedAt: NOW });
    // Chess.com connected meanwhile: it takes over, though Lichess is the one picked.
    state.chesscom = CHESSCOM;
    expect(await accounts.inCharge()).toBe("chesscom");
    await accounts.apply();
    expect(state.ratings.rapid).toEqual({ source: "chesscom", rating: 1684, syncedAt: NOW });
    expect(state.ratings.classical).toEqual({ source: "manual", rating: 1900 });
  });

  it("doesn't write when nothing changes", async () => {
    const { state, accounts } = harness();
    state.chesscom = CHESSCOM;
    await accounts.apply();
    await accounts.apply();
    expect(state.writes).toBe(1);
  });
});
