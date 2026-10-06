import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChesscomAccount, ChesscomEvent } from "@chaturanga/shared/types/chesscom";
import { ChesscomRatingSync, RATING_SYNC_INTERVAL_MS } from "./rating-sync";

const ACCOUNT: ChesscomAccount = {
  id: "ayush_p64",
  username: "ayush_p64",
  title: null,
  ratings: { rapid: 1684 },
  connectedAt: 1,
  lastSyncAt: null
};

const status = (account: ChesscomAccount | null): ChesscomEvent => ({
  type: "status",
  status: { account, connecting: false }
});

function setup() {
  const state = { offline: false, account: ACCOUNT as ChesscomAccount | null };
  const refreshAccount = vi.fn(async () => {
    if (state.offline) throw new TypeError("fetch failed");
    return state.account;
  });
  const applyRatings = vi.fn(async () => undefined);
  const log = vi.fn();
  const sync = new ChesscomRatingSync({ refreshAccount, applyRatings, log });
  return { sync, state, refreshAccount, applyRatings, log };
}

let running: ChesscomRatingSync | null = null;
afterEach(() => {
  running?.stop();
  running = null;
  vi.useRealTimers();
});

describe("ChesscomRatingSync", () => {
  it("reads the ratings, then brings Settings → Ratings in step", async () => {
    const { sync, refreshAccount, applyRatings } = setup();
    await sync.sync();
    expect(refreshAccount).toHaveBeenCalledTimes(1);
    expect(applyRatings).toHaveBeenCalledTimes(1);
  });

  it("offline, applies the saved ratings as they are, and only logs", async () => {
    const { sync, state, applyRatings, log } = setup();
    state.offline = true;
    await sync.sync();
    expect(applyRatings).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      "ratings sync failed; keeping the last values:",
      expect.any(TypeError)
    );
  });

  it("reads a newly connected account, and hands the ratings back when it goes", async () => {
    const { sync, refreshAccount, applyRatings } = setup();
    sync.handleEvent(status(ACCOUNT));
    await vi.waitFor(() => expect(applyRatings).toHaveBeenCalledTimes(1));
    expect(refreshAccount).toHaveBeenCalledTimes(1);
    // Its own status updates (an import finishing) don't read it again.
    sync.handleEvent(status(ACCOUNT));
    sync.handleEvent(status(null));
    await vi.waitFor(() => expect(applyRatings).toHaveBeenCalledTimes(2));
    expect(refreshAccount).toHaveBeenCalledTimes(1);
  });

  it("syncs on start, then hourly until stopped", async () => {
    vi.useFakeTimers();
    const { sync, refreshAccount } = setup();
    running = sync;
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshAccount).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RATING_SYNC_INTERVAL_MS);
    expect(refreshAccount).toHaveBeenCalledTimes(2);
    sync.stop();
    await vi.advanceTimersByTimeAsync(RATING_SYNC_INTERVAL_MS);
    expect(refreshAccount).toHaveBeenCalledTimes(2);
  });
});
