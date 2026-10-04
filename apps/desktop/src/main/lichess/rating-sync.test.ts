import { afterEach, describe, expect, it, vi } from "vitest";
import type { LichessAccount, LichessEvent } from "@chaturanga/shared/types/lichess";
import {
  setManualRating,
  uniformRatings,
  type PlayerRatings
} from "@chaturanga/shared/types/ratings";
import { GAME_END_SYNC_DELAY_MS, LichessRatingSync, RATING_SYNC_INTERVAL_MS } from "./rating-sync";

const NOW = 1_700_000_000_000;

const ACCOUNT: LichessAccount = {
  id: "kenneth",
  username: "Kenneth",
  title: null,
  perfs: {
    blitz: { rating: 1720, games: 300, provisional: false },
    rapid: { rating: 1810, games: 4, provisional: true }
  },
  connectedAt: 1000,
  lastSyncAt: null
};

/** A fake Lichess client and the stored ratings it syncs into. */
function setup(start: PlayerRatings = uniformRatings(1500)) {
  let stored = start;
  const state = {
    /** What `/api/account` answers: an account, none connected, or a network failure. */
    lichess: { kind: "connected", account: ACCOUNT } as
      | { kind: "connected"; account: LichessAccount }
      | { kind: "disconnected" }
      | { kind: "offline" }
  };
  const refreshAccount = vi.fn(async () => {
    if (state.lichess.kind === "offline") throw new TypeError("fetch failed");
    return state.lichess.kind === "connected" ? state.lichess.account : null;
  });
  const writes: PlayerRatings[] = [];
  const log = vi.fn();
  const sync = new LichessRatingSync({
    refreshAccount,
    readRatings: () => stored,
    writeRatings: (ratings) => {
      stored = ratings;
      writes.push(ratings);
    },
    now: () => NOW,
    log
  });
  return { sync, state, refreshAccount, writes, log, ratings: () => stored };
}

const status = (account: LichessAccount | null, tokenRejected = false): LichessEvent => ({
  type: "status",
  status: { account, connecting: false, tokenRejected }
});

const gameState = (gameId: string, gameStatus: string): LichessEvent => ({
  type: "gameState",
  gameId,
  state: {
    moves: ["e2e4"],
    wtime: 1000,
    btime: 1000,
    winc: 0,
    binc: 0,
    status: gameStatus,
    winner: gameStatus === "started" ? null : "white",
    drawOffer: null
  }
});
const gameEnded = (gameId: string) => gameState(gameId, "resign");

let running: LichessRatingSync | null = null;
afterEach(() => {
  running?.stop();
  running = null;
  vi.useRealTimers();
});

describe("LichessRatingSync", () => {
  it("fills the modes from a connected account on app open", async () => {
    const { sync, ratings } = setup();
    await sync.sync();
    expect(ratings()).toEqual({
      ...uniformRatings(1500),
      blitz: { source: "lichess", rating: 1720, syncedAt: NOW },
      rapid: { source: "lichess", rating: 1810, syncedAt: NOW }
    });
  });

  it("replaces a rating typed while disconnected, provisional on Lichess or not", async () => {
    const { sync, ratings } = setup(setManualRating(uniformRatings(1500), "rapid", 1650));
    await sync.sync();
    expect(ratings().rapid).toEqual({ source: "lichess", rating: 1810, syncedAt: NOW });
    expect(ratings().blitz).toEqual({ source: "lichess", rating: 1720, syncedAt: NOW });
  });

  it("keeps the last values offline, and only logs", async () => {
    const { sync, state, ratings, writes, log } = setup();
    await sync.sync();
    const synced = ratings();
    state.lichess = { kind: "offline" };
    await expect(sync.sync()).resolves.toBeUndefined();
    expect(ratings()).toBe(synced);
    expect(writes).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/keeping the last values/),
      expect.any(TypeError)
    );
  });

  it("changes nothing without a connected account", async () => {
    const { sync, state, writes } = setup();
    state.lichess = { kind: "disconnected" };
    await sync.sync();
    expect(writes).toEqual([]);
  });

  it("keeps the synced values as typed-in ones on disconnect", async () => {
    const { sync, state, ratings } = setup();
    await sync.sync();
    state.lichess = { kind: "disconnected" };
    sync.handleEvent(status(null));
    await vi.waitFor(() =>
      expect(ratings()).toEqual({
        ...uniformRatings(1500),
        blitz: { source: "manual", rating: 1720 },
        rapid: { source: "manual", rating: 1810 }
      })
    );
  });

  it("doesn't let a sync still running put Lichess values back after a disconnect", async () => {
    const { sync, refreshAccount, ratings } = setup();
    await sync.sync();
    let answer: (account: LichessAccount) => void = () => undefined;
    refreshAccount.mockImplementationOnce(
      () => new Promise<LichessAccount>((resolve) => (answer = resolve))
    );
    const pending = sync.sync();
    sync.handleEvent(status(null));
    answer({ ...ACCOUNT, perfs: { blitz: { rating: 1731, games: 301, provisional: false } } });
    await pending;
    await vi.waitFor(() => expect(ratings().blitz).toEqual({ source: "manual", rating: 1720 }));
  });

  it("reads the ratings when an account connects, not again on its own status updates", async () => {
    const { sync, refreshAccount } = setup();
    sync.handleEvent(status(ACCOUNT));
    await vi.waitFor(() => expect(refreshAccount).toHaveBeenCalledTimes(1));
    await sync.sync();
    refreshAccount.mockClear();
    sync.handleEvent(status(ACCOUNT));
    // A rejected token can't be read with.
    sync.handleEvent(status({ ...ACCOUNT, id: "salma" }, true));
    expect(refreshAccount).not.toHaveBeenCalled();
  });

  it("syncs a little after a Lichess game played in the app ends, once per game", async () => {
    vi.useFakeTimers();
    const { sync, refreshAccount } = setup();
    sync.handleEvent(gameEnded("g1"));
    sync.handleEvent(gameEnded("g1"));
    expect(refreshAccount).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(GAME_END_SYNC_DELAY_MS);
    expect(refreshAccount).toHaveBeenCalledTimes(1);
    // A game still being played isn't an end.
    sync.handleEvent(gameState("g2", "started"));
    await vi.advanceTimersByTimeAsync(GAME_END_SYNC_DELAY_MS);
    expect(refreshAccount).toHaveBeenCalledTimes(1);
  });

  it("syncs on start, then hourly until stopped", async () => {
    vi.useFakeTimers();
    const { sync, refreshAccount } = setup();
    running = sync;
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshAccount).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RATING_SYNC_INTERVAL_MS - 1);
    expect(refreshAccount).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refreshAccount).toHaveBeenCalledTimes(2);
    sync.stop();
    sync.handleEvent(gameEnded("g3"));
    await vi.advanceTimersByTimeAsync(2 * RATING_SYNC_INTERVAL_MS);
    expect(refreshAccount).toHaveBeenCalledTimes(2);
  });
});
