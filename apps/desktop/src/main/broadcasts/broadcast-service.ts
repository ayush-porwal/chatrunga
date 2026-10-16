/**
 * Lichess broadcasts (relays of over-the-board events): the lists, tournaments, rounds and
 * standings, and the live PGN stream of a watched round. Broadcast data is public: requests go
 * signed in only with a token that may read studies (`getToken`; Lichess refuses a token that
 * lacks the scope rather than ignoring it), for the higher limits, else anonymously. A token
 * Lichess refuses here anyway is dropped: the requests go on anonymously.
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
import { errorMessage, logger } from "../logger";
import {
  isPermanent,
  reconnectDelay,
  sleep,
  STABLE_CONNECTION_MS
} from "../lichess/lichess-service";
import { LichessClient, LichessHttpError, type FetchLike } from "../lichess/http";
import {
  liveGameFromPgn,
  normalizeRoundDetail,
  normalizeSearch,
  normalizeStandings,
  normalizeTopPage,
  normalizeTourDetail
} from "./normalize";

/** A request with the token that may read studies, or an anonymous one. */
type SignedIn = { token: string } | { auth: false };

/** Lichess sends a keep-alive space after 60 s of silence on a broadcast stream. */
const STREAM_IDLE_TIMEOUT_MS = 100_000;

/**
 * A watched round. It lives while it has watchers, whatever its stream does: a failing stream
 * retries (or, refused for good, stops and says why) without the watchers' count changing.
 */
type RoundWatch = {
  watchers: number;
  controller: AbortController;
  /** The latest of each game, by id, as the stream sent it. */
  games: Map<string, BroadcastLiveGame>;
  /** The stream's trouble, if any: the last `connection` event while it isn't connected. */
  trouble: Extract<BroadcastEvent, { type: "connection" }> | null;
};

export type BroadcastServiceOptions = {
  fetch?: FetchLike;
  /** The saved Lichess token when it may read studies, else null (anonymous requests). */
  getToken?: () => Promise<string | null>;
};

export class BroadcastService extends EventEmitter<{ event: [BroadcastEvent] }> {
  private readonly client: LichessClient;
  private readonly watches = new Map<string, RoundWatch>();
  /** The token Lichess refused here (401): anonymous while it is the one saved. */
  private refusedToken: string | null = null;

  constructor(private readonly options: BroadcastServiceOptions = {}) {
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
    return normalizeStandings(await this.json(`/broadcast/${tourId}/players`));
  }

  /**
   * Watches a round until its last watcher leaves: its games arrive as `game` events (all of them
   * at once for a watcher joining a streamed round), its stream's trouble as `connection` events.
   */
  watchRound(roundId: string): void {
    const existing = this.watches.get(roundId);
    if (existing) {
      existing.watchers += 1;
      for (const game of existing.games.values()) this.emit("event", { type: "game", game });
      if (existing.trouble) this.emit("event", existing.trouble);
      return;
    }
    const watch: RoundWatch = {
      watchers: 1,
      controller: new AbortController(),
      games: new Map(),
      trouble: null
    };
    this.watches.set(roundId, watch);
    void this.runRoundStream(roundId, watch);
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
    const signedIn = await this.signedIn();
    try {
      const response = await this.client.request(path, signedIn);
      return await response.json();
    } catch (error) {
      if (!this.tokenWasRefused(signedIn, error)) throw error;
      return this.json(path);
    }
  }

  /** How a request goes: with the token that may read studies, or anonymously. */
  private async signedIn(): Promise<SignedIn> {
    if (!this.options.getToken) return { auth: false };
    const token = await this.options.getToken().catch(() => null);
    // A token refused before stays out; one saved since (signed in again) is tried.
    return token && token !== this.refusedToken ? { token } : { auth: false };
  }

  /**
   * Whether `error` is Lichess refusing the token a request sent (401: a 403 may be a block page
   * or a private broadcast, not the token). It is set aside: anonymous until another is saved.
   */
  private tokenWasRefused(sent: SignedIn, error: unknown): boolean {
    if (!("token" in sent) || !(error instanceof LichessHttpError) || error.status !== 401)
      return false;
    logger.warn("broadcasts", "Lichess refused the token; going on anonymously");
    this.refusedToken = sent.token;
    return true;
  }

  /**
   * Keeps the round's stream open until the watch ends: a dropped or failed connection (the first
   * one too) is retried with backoff; one refused for good (a 4xx other than a rate limit) stops,
   * saying why.
   */
  private async runRoundStream(roundId: string, watch: RoundWatch): Promise<void> {
    const { signal } = watch.controller;
    let attempt = 0;
    while (!signal.aborted) {
      let openedAt = 0;
      let dropError: unknown = null;
      const signedIn = await this.signedIn();
      try {
        await this.streamRound(roundId, watch, {
          signal,
          signedIn,
          onOpen: () => {
            openedAt = Date.now();
            this.setTrouble(roundId, watch, null);
          }
        });
      } catch (error) {
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- the signal can abort while the stream is awaited; TS keeps the loop condition's narrowing
        if (signal.aborted) return;
        // Refused signed in: straight back, anonymously.
        if (this.tokenWasRefused(signedIn, error)) continue;
        logger.warn("broadcasts", `round ${roundId} stream dropped:`, error);
        dropError = error;
      }
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- as above
      if (signal.aborted) return;
      const message = dropError ? errorMessage(dropError) : null;
      if (isPermanent(dropError)) {
        this.setTrouble(roundId, watch, { message, retrying: false });
        return;
      }
      this.setTrouble(roundId, watch, { message, retrying: true });
      if (openedAt && Date.now() - openedAt > STABLE_CONNECTION_MS) attempt = 0;
      await sleep(reconnectDelay(attempt++, dropError), signal);
    }
  }

  /** Records and announces the stream's state (null: connected). */
  private setTrouble(
    roundId: string,
    watch: RoundWatch,
    trouble: { message: string | null; retrying: boolean } | null
  ): void {
    if (!trouble && !watch.trouble) return;
    const event: Extract<BroadcastEvent, { type: "connection" }> = {
      type: "connection",
      roundId,
      connected: trouble === null,
      error: trouble?.message ?? null,
      retrying: trouble?.retrying ?? false
    };
    watch.trouble = trouble ? event : null;
    this.emit("event", event);
  }

  /**
   * One connection to the round's PGN stream: every game once, then each game again whenever it
   * changes. Returns when Lichess closes it; a connection silent past the keep-alive throws.
   */
  private async streamRound(
    roundId: string,
    watch: RoundWatch,
    connection: { signal: AbortSignal; signedIn: SignedIn; onOpen: () => void }
  ): Promise<void> {
    const { signal, signedIn, onOpen } = connection;
    const splitter = createPgnGameSplitter((game) => {
      const live = liveGameFromPgn(game, roundId);
      if (!live) return;
      watch.games.set(live.id, live);
      this.emit("event", { type: "game", game: live });
    });
    await this.client.streamBody(
      `/api/stream/broadcast/round/${roundId}.pgn?clocks=true&comments=false`,
      {
        ...signedIn,
        accept: "application/x-chess-pgn",
        signal,
        idleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
        onOpen
      },
      async (body, touch) => {
        const reader = body.getReader();
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
      }
    );
  }
}
