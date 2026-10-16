/**
 * Lichess broadcasts (relays of over-the-board events): the lists, tournaments, rounds and
 * standings, and the live PGN stream of a watched round. Broadcast data is public, so every
 * request is anonymous: a saved Lichess token is never sent (its scopes don't cover studies, and
 * Lichess refuses a token that lacks the scope rather than ignoring it).
 *
 * Anonymous limits: round and tournament JSON share about 30 requests per 3 minutes, and only two
 * PGN streams may be open at once. So a round's boards come from one summary request, then every
 * change arrives on the round's stream (shared by every watcher of that round). Each watched round
 * keeps the games it last sent, so a new watcher gets them all at once without a new request.
 */
import { EventEmitter } from "node:events";
import { createPgnGameSplitter } from "@chaturanga/shared/chess/pgn-game-splitter";
import type {
  BroadcastEvent,
  BroadcastListing,
  BroadcastLiveGame,
  BroadcastRoundDetail,
  BroadcastStanding,
  BroadcastTopPage,
  BroadcastTourDetail
} from "@chaturanga/shared/types/broadcast";
import { logger } from "../logger";
import { reconnectDelay } from "../lichess/lichess-service";
import { isAbortError, LichessClient, LichessHttpError, type FetchLike } from "../lichess/http";
import {
  liveGameFromPgn,
  normalizeRoundDetail,
  normalizeSearch,
  normalizeStandings,
  normalizeTopPage,
  normalizeTourDetail
} from "./normalize";

/** Lichess sends a keep-alive space after 60 s of silence on a broadcast stream. */
const STREAM_IDLE_TIMEOUT_MS = 100_000;
/** A connection that stayed up this long resets the backoff. */
const STABLE_CONNECTION_MS = 30_000;

type RoundWatch = {
  watchers: number;
  controller: AbortController;
  /** The latest of each game, by id, as the stream sent it. */
  games: Map<string, BroadcastLiveGame>;
};

export type BroadcastServiceOptions = { fetch?: FetchLike };

/** Resolves after `ms`, or as soon as `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

export class BroadcastService extends EventEmitter<{ event: [BroadcastEvent] }> {
  private readonly client: LichessClient;
  private readonly watches = new Map<string, RoundWatch>();

  constructor(options: BroadcastServiceOptions = {}) {
    super();
    this.client = new LichessClient({
      fetch: options.fetch,
      getToken: () => Promise.resolve(null)
    });
  }

  async top(page = 1): Promise<BroadcastTopPage> {
    return normalizeTopPage(await this.json(`/api/broadcast/top?page=${page}`));
  }

  async search(query: string): Promise<BroadcastListing[]> {
    const params = new URLSearchParams({ q: query });
    return normalizeSearch(await this.json(`/api/broadcast/search?${params.toString()}`));
  }

  async tournament(tourId: string): Promise<BroadcastTourDetail> {
    return normalizeTourDetail(await this.json(`/api/broadcast/${tourId}`));
  }

  async round(roundId: string): Promise<BroadcastRoundDetail> {
    // The slugs are ignored by Lichess: the round id is enough.
    return normalizeRoundDetail(await this.json(`/api/broadcast/-/-/${roundId}`));
  }

  async players(tourId: string): Promise<BroadcastStanding[]> {
    const response = await this.client.request(`/broadcast/${tourId}/players`, { auth: false });
    return normalizeStandings(await response.json());
  }

  /**
   * Streams a round until its last watcher leaves. Resolves once the stream is open (rejects if the
   * first connection fails); a new watcher of a streamed round gets its games right away.
   */
  async watchRound(roundId: string): Promise<void> {
    const existing = this.watches.get(roundId);
    if (existing) {
      existing.watchers += 1;
      for (const game of existing.games.values()) this.emit("event", { type: "game", game });
      return;
    }
    const watch: RoundWatch = { watchers: 1, controller: new AbortController(), games: new Map() };
    this.watches.set(roundId, watch);
    await new Promise<void>((resolve, reject) => {
      void this.runRoundStream(roundId, watch, resolve, reject);
    });
  }

  unwatchRound(roundId: string): void {
    const watch = this.watches.get(roundId);
    if (!watch) return;
    watch.watchers -= 1;
    if (watch.watchers > 0) return;
    this.watches.delete(roundId);
    watch.controller.abort();
  }

  shutdown(): void {
    for (const watch of this.watches.values()) watch.controller.abort();
    this.watches.clear();
  }

  private async json(path: string): Promise<unknown> {
    const response = await this.client.request(path, { auth: false });
    return response.json();
  }

  private async runRoundStream(
    roundId: string,
    watch: RoundWatch,
    opened: () => void,
    failed: (error: unknown) => void
  ): Promise<void> {
    const { signal } = watch.controller;
    let firstAttempt = true;
    let connected = true;
    let attempt = 0;
    try {
      while (!signal.aborted) {
        let openedAt = 0;
        let dropError: unknown = null;
        try {
          await this.streamRound(
            roundId,
            signal,
            () => {
              openedAt = Date.now();
              if (firstAttempt) opened();
              if (!connected) {
                connected = true;
                this.emit("event", { type: "connection", roundId, connected: true, error: null });
              }
            },
            (game) => {
              watch.games.set(game.id, game);
              this.emit("event", { type: "game", game });
            }
          );
        } catch (error) {
          // oxlint-disable-next-line typescript/no-unnecessary-condition -- the signal can abort while the stream is awaited; TS keeps the loop condition's narrowing
          if (signal.aborted) return;
          if (firstAttempt && !openedAt) {
            failed(error);
            return;
          }
          dropError = error;
        }
        firstAttempt = false;
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- the signal can abort while the stream is awaited; TS keeps the loop condition's narrowing
        if (signal.aborted) return;
        if (connected) {
          connected = false;
          const error = dropError instanceof Error ? dropError.message : null;
          this.emit("event", { type: "connection", roundId, connected: false, error });
        }
        if (openedAt && Date.now() - openedAt > STABLE_CONNECTION_MS) attempt = 0;
        await sleep(reconnectDelay(attempt++, dropError), signal);
      }
    } finally {
      if (firstAttempt) failed(new Error("The broadcast stream was stopped."));
      if (this.watches.get(roundId) === watch) this.watches.delete(roundId);
    }
  }

  /**
   * One connection to the round's PGN stream: every game once, then each game again whenever it
   * changes. Returns when Lichess closes it; a connection silent past the keep-alive throws.
   */
  private async streamRound(
    roundId: string,
    outer: AbortSignal,
    onOpen: () => void,
    onGame: (game: BroadcastLiveGame) => void
  ): Promise<void> {
    const controller = new AbortController();
    const abortFromOuter = () => controller.abort();
    outer.addEventListener("abort", abortFromOuter, { once: true });
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const touch = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), STREAM_IDLE_TIMEOUT_MS);
    };
    const splitter = createPgnGameSplitter((game) => {
      const live = liveGameFromPgn(game, roundId);
      if (live) onGame(live);
    });
    try {
      touch();
      const response = await this.client.request(
        `/api/stream/broadcast/round/${roundId}.pgn?clocks=true&comments=false`,
        { auth: false, accept: "application/x-chess-pgn", signal: controller.signal }
      );
      touch();
      onOpen();
      if (!response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          touch();
          splitter.write(decoder.decode(value, { stream: true }));
        }
        splitter.write(decoder.decode());
        splitter.end();
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    } catch (error) {
      if (controller.signal.aborted && !outer.aborted)
        throw new LichessHttpError("The broadcast stream went silent.", 0);
      if (!isAbortError(error))
        logger.warn("broadcasts", `round ${roundId} stream dropped:`, error);
      throw error;
    } finally {
      clearTimeout(idleTimer);
      outer.removeEventListener("abort", abortFromOuter);
    }
  }
}
