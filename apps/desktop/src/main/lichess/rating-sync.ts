/**
 * Keeps Settings → Ratings in step with the connected Lichess account (while it is the one that
 * fills them, see main/account-ratings.ts): the modes fill from the account's ratings on app open,
 * when an account connects, after a Lichess game played in the app ends, and hourly while the app
 * is open. Offline, the last values stay (the failure is only logged). Disconnecting keeps the
 * synced values, as typed-in ones.
 */
import type { LichessAccount, LichessEvent } from "@chaturanga/shared/types/lichess";
import {
  applyLichessPerfs,
  hasLichessRatings,
  releaseLichessRatings,
  type PlayerRatings
} from "@chaturanga/shared/types/ratings";
import { isFinalStatus } from "./normalize";

/** How often the ratings are read again while the app is open. */
export const RATING_SYNC_INTERVAL_MS = 60 * 60 * 1000;
/** A finished game's rating change takes Lichess a moment; read the account a little after. */
export const GAME_END_SYNC_DELAY_MS = 5_000;

export type LichessRatingSyncDeps = {
  /** The connected account read again from Lichess; null when none is connected. Rejects offline. */
  refreshAccount: () => Promise<LichessAccount | null>;
  /** The stored ratings, read at the moment of writing (a change made meanwhile is kept). */
  readRatings: () => PlayerRatings;
  /** Stores the ratings and tells the renderer. */
  writeRatings: (ratings: PlayerRatings) => void;
  /**
   * Whether Lichess fills the ratings now (Chess.com may, see main/account-ratings.ts); when it
   * doesn't, a sync only refreshes the account. Always, when absent.
   */
  inCharge?: () => Promise<boolean>;
  now?: () => number;
  log?: (message: string, error?: unknown) => void;
};

export class LichessRatingSync {
  private running: Promise<void> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly timeouts = new Set<ReturnType<typeof setTimeout>>();
  /** Games whose end already asked for a sync (a game stream may repeat its last state). */
  private readonly endedGames = new Set<string>();
  /** The account the ratings were last read for; null: none connected; undefined: not known yet. */
  private accountId: string | null | undefined = undefined;
  private stopped = false;
  /** Counts disconnects: a read that started before one is stale. */
  private disconnects = 0;

  constructor(private readonly deps: LichessRatingSyncDeps) {}

  /** App open: reads the ratings now, then hourly. */
  start(): void {
    this.stopped = false;
    void this.sync();
    if (!this.interval)
      this.interval = setInterval(() => void this.sync(), RATING_SYNC_INTERVAL_MS);
  }

  /** App quit: no more syncs (one already running finishes on its own). */
  stop(): void {
    this.stopped = true;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    for (const timeout of this.timeouts) clearTimeout(timeout);
    this.timeouts.clear();
  }

  /** Reads the account's ratings into Settings. One at a time: a call during a run joins it. Never rejects. */
  sync(): Promise<void> {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  /** Follows the Lichess service's events: connects, disconnects and finished games. */
  handleEvent(event: LichessEvent): void {
    if (this.stopped) return;
    if (event.type === "status") {
      const { account, tokenRejected } = event.status;
      if (!account) {
        this.accountId = null;
        this.disconnects += 1;
        // After a sync still running, so it can't put Lichess values back.
        void (this.running ?? Promise.resolve()).then(() => this.release());
      } else if (!tokenRejected && account.id !== this.accountId) {
        void this.sync();
      }
    } else if (event.type === "gameState" && isFinalStatus(event.state.status)) {
      if (this.endedGames.has(event.gameId)) return;
      this.endedGames.add(event.gameId);
      const timeout = setTimeout(() => {
        this.timeouts.delete(timeout);
        void this.sync();
      }, GAME_END_SYNC_DELAY_MS);
      this.timeouts.add(timeout);
    }
  }

  private async run(): Promise<void> {
    const disconnects = this.disconnects;
    let account: LichessAccount | null;
    try {
      account = await this.deps.refreshAccount();
    } catch (error) {
      // Offline, or Lichess is down: the last values stay.
      this.deps.log?.("ratings sync failed; keeping the last values:", error);
      return;
    }
    // Disconnected while Lichess answered: its ratings are no longer the account's.
    if (!account || disconnects !== this.disconnects) return;
    this.accountId = account.id;
    if (this.deps.inCharge) {
      let inCharge: boolean;
      try {
        inCharge = await this.deps.inCharge();
      } catch (error) {
        this.deps.log?.("couldn't tell which account fills the ratings:", error);
        return;
      }
      if (!inCharge || disconnects !== this.disconnects) return;
    }
    const syncedAt = this.deps.now?.() ?? Date.now();
    this.update((current) => applyLichessPerfs(current, account.perfs, syncedAt));
  }

  /** No account any more: the synced values stay, as typed-in ones. */
  private release(): void {
    if (this.accountId !== null) return; // Connected again meanwhile.
    this.update((current) =>
      hasLichessRatings(current) ? releaseLichessRatings(current) : current
    );
  }

  /** Reads, changes and writes the ratings in one go; a failed write is logged (the next sync retries). */
  private update(change: (current: PlayerRatings) => PlayerRatings): void {
    try {
      const current = this.deps.readRatings();
      const next = change(current);
      if (JSON.stringify(next) !== JSON.stringify(current)) this.deps.writeRatings(next);
    } catch (error) {
      this.deps.log?.("ratings couldn't be saved:", error);
    }
  }
}
