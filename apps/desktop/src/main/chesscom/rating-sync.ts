/**
 * Keeps the connected chess.com account's ratings fresh: they are read again on app open, when an
 * account connects, and hourly while the app is open, then Settings → Ratings is brought in step
 * (main/account-ratings.ts: chess.com fills it while it is the account in charge). Offline, the
 * last values stay (the failure is only logged). Disconnecting keeps the synced values, as
 * typed-in ones.
 */
import type { ChesscomAccount, ChesscomEvent } from "@chaturanga/shared/types/chesscom";

/** How often the ratings are read again while the app is open. */
export const RATING_SYNC_INTERVAL_MS = 60 * 60 * 1000;

export type ChesscomRatingSyncDeps = {
  /** The connected account read again from chess.com; null when none is connected. Rejects offline. */
  refreshAccount: () => Promise<ChesscomAccount | null>;
  /** Fills Settings → Ratings from the account in charge (never rejects). */
  applyRatings: () => Promise<void>;
  log?: (message: string, error?: unknown) => void;
};

export class ChesscomRatingSync {
  private running: Promise<void> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  /** The account the ratings were last read for; null: none connected; undefined: not known yet. */
  private accountId: string | null | undefined = undefined;
  private stopped = false;

  constructor(private readonly deps: ChesscomRatingSyncDeps) {}

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
  }

  /** Reads the ratings and applies them. One at a time: a call during a run joins it. Never rejects. */
  sync(): Promise<void> {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  /** Follows the service's status: a newly connected account is read; one gone gives the ratings up. */
  handleEvent(event: ChesscomEvent): void {
    if (this.stopped || event.type !== "status") return;
    const { account } = event.status;
    if (!account) {
      if (this.accountId === null) return;
      this.accountId = null;
      // After a sync still running, so the release is the last word.
      void (this.running ?? Promise.resolve()).then(() => this.deps.applyRatings());
    } else if (account.id !== this.accountId) {
      this.accountId = account.id;
      void this.sync();
    }
  }

  private async run(): Promise<void> {
    try {
      const account = await this.deps.refreshAccount();
      this.accountId = account?.id ?? null;
    } catch (error) {
      // Offline, or chess.com is down: the saved ratings are applied as they are.
      this.deps.log?.("ratings sync failed; keeping the last values:", error);
    }
    await this.deps.applyRatings();
  }
}
