/**
 * Lichess account, play (Board API) and game import. Owns the OAuth token and every request to
 * lichess.org; the renderer calls it over IPC and follows its `event` emissions.
 *
 * Long-lived connections:
 * - the event stream (`/api/stream/event`: game starts, challenges) runs while an account with a
 *   usable token is connected. It starts lazily on the renderer's first `status()` (or connect,
 *   seek, challenge) and reconnects with exponential backoff until disconnect or quit;
 * - a seek is a POST whose response stays open: aborting it cancels the seek on Lichess;
 * - an outgoing challenge uses `keepAliveStream`, so it doesn't expire after 20 s;
 * - each watched game has a stream, shared by every watcher of that game, reconnecting until the
 *   game ends (a reconnect starts with a fresh `gameFull`).
 * Streams that go silent past Lichess's 7 s keep-alive (see STREAM_IDLE_TIMEOUT_MS) count as
 * dropped. Lichess asks clients to wait a full minute after a 429.
 */
import { EventEmitter } from "node:events";
import type { GameSource } from "@chaturanga/shared/types/chess";
import type {
  LichessAiChallengeInput,
  LichessChallenge,
  LichessChallengeInput,
  LichessEvent,
  LichessGameFull,
  LichessSeekInput,
  LichessStatus,
  LichessSyncResult
} from "@chaturanga/shared/types/lichess";
import { errorMessage, logger } from "../logger";
import type { LichessAccountStore } from "./account-store";
import { importLichessGames, sinceForSync, type ImportRepository } from "./game-import";
import {
  isAbortError,
  LichessClient,
  LichessHttpError,
  NOT_CONNECTED_ERROR,
  TOKEN_REJECTED_ERROR,
  type FetchLike
} from "./http";
import {
  assertRapidOrSlower,
  eventFromStream,
  isFinalStatus,
  normalizeAccount,
  normalizeChallenge,
  normalizeGameFull,
  normalizeGameState
} from "./normalize";
import { authorizeInBrowser, OAuthCancelledError } from "./oauth";

const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
const RATE_LIMIT_WAIT_MS = 60_000;
/** A connection that stayed up this long resets the backoff. */
const STABLE_CONNECTION_MS = 30_000;
/** Lichess sends a keep-alive newline every 7 s on the event and game streams. */
const STREAM_IDLE_TIMEOUT_MS = 30_000;
const REVOKE_TIMEOUT_MS = 5000;

/** Delay before reconnect attempt `attempt` (0-based) after `error` (null: closed by the server). */
export function reconnectDelay(attempt: number, error: unknown): number {
  if (error instanceof LichessHttpError && error.status === 429) return RATE_LIMIT_WAIT_MS;
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
}

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

/** Errors that retrying won't fix (other than rate limiting). */
function isPermanent(error: unknown): boolean {
  return (
    error instanceof LichessHttpError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  );
}

type GameWatch = { watchers: number; controller: AbortController; last: LichessGameFull | null };

export type LichessGameStore = ImportRepository & { removeBySource(source: GameSource): number };

export type LichessServiceOptions = {
  store: LichessAccountStore;
  games: LichessGameStore;
  openExternal: (url: string) => Promise<void>;
  fetch?: FetchLike;
};

export class LichessService extends EventEmitter<{ event: [LichessEvent] }> {
  private readonly client: LichessClient;
  /** The decrypted token, cached so each request doesn't go back to the keychain. */
  private token: string | null = null;
  private connectController: AbortController | null = null;
  private eventStream: { controller: AbortController; opened: Promise<void> } | null = null;
  private seekController: AbortController | null = null;
  private readonly challengeStreams = new Map<string, AbortController>();
  private readonly gameWatches = new Map<string, GameWatch>();
  private sync: Promise<LichessSyncResult> | null = null;
  private syncController: AbortController | null = null;

  constructor(private readonly options: LichessServiceOptions) {
    super();
    this.client = new LichessClient({
      fetch: options.fetch,
      getToken: () => this.getToken(),
      onTokenRejected: (token) => void this.handleTokenRejected(token)
    });
  }

  // --- Account ---------------------------------------------------------------------------------

  async status(): Promise<LichessStatus> {
    const status = await this.readStatus();
    if (status.account && !status.tokenRejected) void this.ensureEventStream();
    return status;
  }

  /** A second call cancels the first. Cancelling, declining in the browser or timing out resolve. */
  async connect(): Promise<LichessStatus> {
    this.connectController?.abort();
    const controller = new AbortController();
    this.connectController = controller;
    this.emitStatus();
    let token: string | null = null;
    try {
      token = await authorizeInBrowser({
        openExternal: this.options.openExternal,
        fetch: this.options.fetch,
        signal: controller.signal
      });
      const accountJson = await this.client.json<unknown>("/api/account", {
        token,
        signal: controller.signal
      });
      if (controller.signal.aborted) throw new OAuthCancelledError("cancelled");
      const account = normalizeAccount(accountJson, Date.now());
      const previous = (await this.options.store.status()).account;
      // Another account's games, seek, challenges and import must not carry over.
      if (previous && previous.id !== account.id) {
        this.stopPlay();
        this.syncController?.abort();
      }
      this.stopEventStream();
      await this.options.store.save(account, token);
      this.token = token;
      void this.ensureEventStream();
    } catch (error) {
      if (token && this.token !== token) void this.revoke(token);
      if (!(error instanceof OAuthCancelledError) && !isAbortError(error)) {
        logger.warn("lichess", "connect failed:", error);
        throw error;
      }
    } finally {
      if (this.connectController === controller) {
        this.connectController = null;
        this.emitStatus();
      }
    }
    return this.readStatus();
  }

  cancelConnect(): void {
    this.connectController?.abort();
  }

  /** Revokes the token (best effort), stops everything and forgets the account. */
  async disconnect(options: { removeGames: boolean }): Promise<LichessStatus> {
    this.connectController?.abort();
    this.stopPlay();
    this.syncController?.abort();
    await this.sync?.catch(() => undefined);
    const { account, tokenRejected } = await this.options.store.status();
    if (account && !tokenRejected) {
      const token = this.token ?? (await this.options.store.getToken().catch(() => null));
      if (token) await this.revoke(token);
    }
    this.token = null;
    await this.options.store.clear();
    if (options.removeGames) this.options.games.removeBySource("lichess");
    this.emitStatus();
    return this.readStatus();
  }

  // --- Game import -----------------------------------------------------------------------------

  /** One import at a time: a second call joins the running one. */
  syncGames(): Promise<LichessSyncResult> {
    if (!this.sync) {
      this.sync = this.runSync().finally(() => {
        this.sync = null;
      });
    }
    return this.sync;
  }

  private async runSync(): Promise<LichessSyncResult> {
    const { account, tokenRejected } = await this.options.store.status();
    if (!account) throw new Error(NOT_CONNECTED_ERROR);
    if (tokenRejected) throw new Error(TOKEN_REJECTED_ERROR);
    const controller = new AbortController();
    this.syncController = controller;
    const accountId = account.id;
    let imported = 0;
    this.emitEvent({ type: "sync", running: true, imported, error: null });
    try {
      const previousSince = await this.options.store.syncSince();
      const result = await importLichessGames({
        client: this.client,
        repository: this.options.games,
        username: account.username,
        since: sinceForSync(previousSince, Date.now()),
        signal: controller.signal,
        onProgress: (count) => {
          imported = count;
          this.emitEvent({ type: "sync", running: true, imported, error: null });
        }
      });
      // The cursor belongs to the account that ran the import (another may have connected since).
      if ((await this.options.store.status()).account?.id !== accountId) throw new Error("The account changed.");
      await this.options.store.recordSync(Date.now(), result.nextSince ?? previousSince);
      this.emitEvent({ type: "sync", running: false, imported: result.imported, error: null });
      this.emitStatus();
      return { imported: result.imported, skipped: result.skipped };
    } catch (error) {
      const message = controller.signal.aborted ? "The import was stopped." : errorMessage(error);
      this.emitEvent({ type: "sync", running: false, imported, error: message });
      throw new Error(message, { cause: error });
    } finally {
      if (this.syncController === controller) this.syncController = null;
    }
  }

  // --- Seeks and challenges --------------------------------------------------------------------

  /** Resolves once Lichess accepted the seek; pairing arrives as `gameStart`. Replaces a running seek. */
  async seek(input: LichessSeekInput): Promise<void> {
    assertRapidOrSlower(input.minutes, input.incrementSec);
    this.seekController?.abort();
    const controller = new AbortController();
    this.seekController = controller;
    // Lichess: open the event stream first, so an instant pairing isn't missed.
    await this.ensureEventStream();
    if (this.seekController !== controller) return;
    this.emitEvent({ type: "seek", searching: true, error: null });
    const form = {
      rated: input.rated,
      time: input.minutes,
      increment: input.incrementSec,
      variant: "standard",
      color: "random",
      ratingRange: input.ratingRange ? `${input.ratingRange[0]}-${input.ratingRange[1]}` : undefined
    };
    await new Promise<void>((resolve, reject) => {
      // The response only carries keep-alives; it ends when paired or when the seek expires.
      this.client
        .stream(
          "/api/board/seek",
          { method: "POST", form, signal: controller.signal, onOpen: resolve },
          () => undefined
        )
        .then(
          () => this.endSeek(controller, null),
          (error: unknown) => {
            this.endSeek(controller, error);
            if (isAbortError(error)) resolve();
            else reject(error);
          }
        );
    });
  }

  cancelSeek(): void {
    const controller = this.seekController;
    if (!controller) return;
    this.seekController = null;
    controller.abort();
    this.emitEvent({ type: "seek", searching: false, error: null });
  }

  /** Reports the end of the current seek (a replaced or cancelled one was reported already). */
  private endSeek(controller: AbortController, error: unknown): void {
    if (this.seekController !== controller) return;
    this.seekController = null;
    const message = error && !isAbortError(error) ? errorMessage(error) : null;
    this.emitEvent({ type: "seek", searching: false, error: message });
  }

  /**
   * Challenges a player. The request stays open (`keepAliveStream`) so the challenge doesn't
   * expire; its end (accepted / declined / canceled) is reported as `challengeGone`.
   */
  async challenge(input: LichessChallengeInput): Promise<LichessChallenge> {
    const myId = await this.accountId();
    await this.ensureEventStream();
    const controller = new AbortController();
    const form = {
      rated: input.rated,
      "clock.limit": Math.round(input.minutes * 60),
      "clock.increment": input.incrementSec,
      color: input.color,
      variant: "standard",
      keepAliveStream: true
    };
    return new Promise<LichessChallenge>((resolve, reject) => {
      let challenge: LichessChallenge | null = null;
      let done = false;
      const path = `/api/challenge/${encodeURIComponent(input.username)}`;
      this.client
        .stream(path, { method: "POST", form, signal: controller.signal }, (line) => {
          if (!challenge) {
            challenge = { ...normalizeChallenge(line, myId), direction: "out" };
            this.challengeStreams.set(challenge.id, controller);
            resolve(challenge);
            return;
          }
          const reason = (line as { done?: unknown }).done;
          if (reason === "accepted" || reason === "declined" || reason === "canceled") {
            done = true;
            this.emitEvent({ type: "challengeGone", challengeId: challenge.id, reason });
          }
        })
        .catch((error: unknown) => {
          if (!challenge) reject(error);
          else if (!controller.signal.aborted)
            logger.warn("lichess", "challenge stream dropped:", error);
        })
        .finally(() => {
          if (!challenge) {
            reject(new Error("Lichess didn't return the challenge."));
            return;
          }
          this.challengeStreams.delete(challenge.id);
          // Without its keep-alive the challenge lapses on Lichess.
          if (!done && !controller.signal.aborted) {
            this.emitEvent({
              type: "challengeGone",
              challengeId: challenge.id,
              reason: "canceled"
            });
          }
        });
    });
  }

  async challengeAi(input: LichessAiChallengeInput): Promise<{ gameId: string }> {
    await this.ensureEventStream();
    const body = await this.client.json<{ id?: unknown }>("/api/challenge/ai", {
      method: "POST",
      form: {
        level: input.level,
        "clock.limit": Math.round(input.minutes * 60),
        "clock.increment": input.incrementSec,
        color: input.color,
        variant: "standard"
      }
    });
    if (typeof body.id !== "string" || !body.id) throw new Error("Lichess didn't return the game.");
    return { gameId: body.id };
  }

  async acceptChallenge(challengeId: string): Promise<void> {
    await this.ensureEventStream();
    await this.client.send(`/api/challenge/${challengeId}/accept`);
    this.emitEvent({ type: "challengeGone", challengeId, reason: "accepted" });
  }

  async declineChallenge(challengeId: string): Promise<void> {
    await this.client.send(`/api/challenge/${challengeId}/decline`);
    this.emitEvent({ type: "challengeGone", challengeId, reason: "declined" });
  }

  async cancelChallenge(challengeId: string): Promise<void> {
    const stream = this.challengeStreams.get(challengeId);
    this.challengeStreams.delete(challengeId);
    try {
      await this.client.send(`/api/challenge/${challengeId}/cancel`);
    } finally {
      // Even if the cancel request failed: without its keep-alive stream the challenge lapses.
      stream?.abort();
      this.emitEvent({ type: "challengeGone", challengeId, reason: "canceled" });
    }
  }

  async challenges(): Promise<LichessChallenge[]> {
    const myId = await this.accountId();
    const body = await this.client.json<{ in?: unknown; out?: unknown }>("/api/challenge");
    const list = [
      ...(Array.isArray(body.in) ? body.in : []),
      ...(Array.isArray(body.out) ? body.out : [])
    ];
    const challenges: LichessChallenge[] = [];
    for (const item of list) {
      try {
        challenges.push(normalizeChallenge(item, myId));
      } catch {
        // Skip a malformed entry rather than failing the list.
      }
    }
    return challenges;
  }

  async ongoingGames(): Promise<string[]> {
    const body = await this.client.json<{ nowPlaying?: unknown }>("/api/account/playing?nb=50");
    if (!Array.isArray(body.nowPlaying)) return [];
    return body.nowPlaying
      .map((game) => (game as { gameId?: unknown }).gameId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }

  // --- Games -----------------------------------------------------------------------------------

  /**
   * Streams a game until it ends or its last watcher leaves. Resolves once the stream is open;
   * rejects if the first connection fails. A new watcher of a streamed game gets its latest
   * `gameFull` right away.
   */
  async watchGame(gameId: string): Promise<void> {
    const existing = this.gameWatches.get(gameId);
    if (existing) {
      existing.watchers += 1;
      if (existing.last) this.emitEvent({ type: "gameFull", game: existing.last });
      return;
    }
    const watch: GameWatch = { watchers: 1, controller: new AbortController(), last: null };
    this.gameWatches.set(gameId, watch);
    await new Promise<void>((resolve, reject) => {
      void this.runGameStream(gameId, watch, resolve, reject);
    });
  }

  unwatchGame(gameId: string): void {
    const watch = this.gameWatches.get(gameId);
    if (!watch) return;
    watch.watchers -= 1;
    if (watch.watchers > 0) return;
    this.gameWatches.delete(gameId);
    watch.controller.abort();
  }

  private async runGameStream(
    gameId: string,
    watch: GameWatch,
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
          await this.client.stream(
            `/api/board/game/stream/${gameId}`,
            {
              signal,
              idleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
              onOpen: () => {
                openedAt = Date.now();
                if (firstAttempt) opened();
                if (!connected) {
                  connected = true;
                  this.emitEvent({ type: "gameConnection", gameId, connected: true });
                }
              }
            },
            (line) => this.onGameLine(gameId, watch, line)
          );
        } catch (error) {
          if (signal.aborted) return;
          if (firstAttempt && !openedAt) {
            failed(error);
            return;
          }
          if (isPermanent(error)) {
            logger.warn("lichess", `game ${gameId} stream stopped:`, error);
            return;
          }
          dropError = error;
        }
        firstAttempt = false;
        if (signal.aborted || (watch.last && isFinalStatus(watch.last.state.status))) return;
        if (connected) {
          connected = false;
          this.emitEvent({ type: "gameConnection", gameId, connected: false });
        }
        if (openedAt && Date.now() - openedAt > STABLE_CONNECTION_MS) attempt = 0;
        await sleep(reconnectDelay(attempt++, dropError), signal);
      }
    } finally {
      if (firstAttempt) failed(new Error("The game stream was stopped."));
      if (this.gameWatches.get(gameId) === watch) this.gameWatches.delete(gameId);
    }
  }

  private onGameLine(gameId: string, watch: GameWatch, line: unknown): void {
    const type = (line as { type?: unknown } | null)?.type;
    try {
      if (type === "gameFull") {
        watch.last = { ...normalizeGameFull(line), id: gameId };
        this.emitEvent({ type: "gameFull", game: watch.last });
      } else if (type === "gameState") {
        const state = normalizeGameState(line);
        if (watch.last) watch.last = { ...watch.last, state };
        this.emitEvent({ type: "gameState", gameId, state });
      }
      // chatLine / opponentGone: not shown yet.
    } catch (error) {
      logger.warn("lichess", `ignored a malformed line of game ${gameId}:`, error);
    }
  }

  move(gameId: string, uci: string): Promise<void> {
    return this.client.send(`/api/board/game/${gameId}/move/${uci}`);
  }

  resign(gameId: string): Promise<void> {
    return this.client.send(`/api/board/game/${gameId}/resign`);
  }

  abort(gameId: string): Promise<void> {
    return this.client.send(`/api/board/game/${gameId}/abort`);
  }

  offerDraw(gameId: string): Promise<void> {
    return this.client.send(`/api/board/game/${gameId}/draw/yes`);
  }

  declineDraw(gameId: string): Promise<void> {
    return this.client.send(`/api/board/game/${gameId}/draw/no`);
  }

  /** App quit: close every connection and the sign-in server. Idempotent. */
  shutdown(): void {
    this.connectController?.abort();
    this.syncController?.abort();
    this.stopPlay();
  }

  // --- Internals -------------------------------------------------------------------------------

  private async readStatus(): Promise<LichessStatus> {
    const { account, tokenRejected } = await this.options.store.status();
    return { account, connecting: this.connectController !== null, tokenRejected };
  }

  private emitEvent(event: LichessEvent): void {
    this.emit("event", event);
  }

  private emitStatus(): void {
    void this.readStatus()
      .then((status) => this.emitEvent({ type: "status", status }))
      .catch((error) => logger.error("lichess", "status read failed:", error));
  }

  private async getToken(): Promise<string | null> {
    if (this.token) return this.token;
    const token = await this.options.store.getToken();
    if (token) {
      this.token = token;
      return token;
    }
    // A saved token that no longer decrypts (another computer's profile, keychain denied).
    if (await this.options.store.hasUsableToken()) {
      await this.handleTokenRejected();
      throw new LichessHttpError(TOKEN_REJECTED_ERROR, 401);
    }
    return null;
  }

  private async accountId(): Promise<string> {
    const { account, tokenRejected } = await this.options.store.status();
    if (!account) throw new Error(NOT_CONNECTED_ERROR);
    if (tokenRejected) throw new Error(TOKEN_REJECTED_ERROR);
    return account.id;
  }

  /**
   * `refused`: the token Lichess answered 401 to. A reply to an older token (the account changed
   * since the request went out) says nothing about the current one and is ignored.
   */
  private async handleTokenRejected(refused?: string): Promise<void> {
    if (refused && this.token && refused !== this.token) return;
    this.token = null;
    this.stopPlay();
    const { account, tokenRejected } = await this.options.store.status();
    if (!account || tokenRejected) return;
    await this.options.store.markTokenRejected();
    this.emitStatus();
  }

  private async revoke(token: string): Promise<void> {
    try {
      await this.client.send("/api/token", {
        method: "DELETE",
        token,
        signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS)
      });
    } catch (error) {
      logger.warn("lichess", "token revoke failed:", error);
    }
  }

  /** Resolves once the event stream is open, or after its first failed attempt (never blocks). */
  private ensureEventStream(): Promise<void> {
    if (this.eventStream) return this.eventStream.opened;
    const controller = new AbortController();
    let markOpened: () => void = () => undefined;
    const opened = new Promise<void>((resolve) => {
      markOpened = resolve;
    });
    this.eventStream = { controller, opened };
    void this.runEventStream(controller.signal, markOpened)
      .catch((error) => logger.error("lichess", "event stream failed:", error))
      .finally(() => {
        markOpened();
        if (this.eventStream?.controller === controller) this.eventStream = null;
      });
    return opened;
  }

  private async runEventStream(signal: AbortSignal, markOpened: () => void): Promise<void> {
    const { account, tokenRejected } = await this.options.store.status();
    if (!account || tokenRejected) return;
    let attempt = 0;
    while (!signal.aborted) {
      let openedAt = 0;
      let dropError: unknown = null;
      try {
        await this.client.stream(
          "/api/stream/event",
          {
            signal,
            idleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
            onOpen: () => {
              openedAt = Date.now();
              markOpened();
            }
          },
          (line) => {
            try {
              const event = eventFromStream(line, account.id);
              if (event) this.emitEvent(event);
            } catch (error) {
              logger.warn("lichess", "ignored a malformed event:", error);
            }
          }
        );
      } catch (error) {
        if (signal.aborted) return;
        // 401: handleTokenRejected already stopped everything.
        if (error instanceof LichessHttpError && error.status === 401) return;
        logger.warn("lichess", "event stream dropped:", error);
        dropError = error;
      }
      markOpened();
      if (openedAt && Date.now() - openedAt > STABLE_CONNECTION_MS) attempt = 0;
      await sleep(reconnectDelay(attempt++, dropError), signal);
    }
  }

  private stopEventStream(): void {
    this.eventStream?.controller.abort();
    this.eventStream = null;
  }

  /** Stops the event stream, the seek, outgoing challenges and every game stream. */
  private stopPlay(): void {
    this.stopEventStream();
    this.cancelSeek();
    for (const controller of this.challengeStreams.values()) controller.abort();
    this.challengeStreams.clear();
    for (const watch of this.gameWatches.values()) watch.controller.abort();
    this.gameWatches.clear();
  }
}
