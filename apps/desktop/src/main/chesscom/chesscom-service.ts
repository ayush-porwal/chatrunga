/**
 * The chess.com account and its game import. Owns every request to chess.com (the renderer never
 * reaches it): connecting looks the username up, imports run on app open and on Import now, and
 * the renderer follows the `event` emissions. Chess.com's API is read-only: nothing here changes
 * anything on chess.com, and its games can't be played from the app.
 */
import { EventEmitter } from "node:events";
import type { GameSource } from "@chaturanga/shared/types/chess";
import type {
  ChesscomAccount,
  ChesscomConnectInput,
  ChesscomEvent,
  ChesscomStatus,
  ChesscomSyncResult
} from "@chaturanga/shared/types/chesscom";
import { errorMessage, logger } from "../logger";
import type { ChesscomAccountStore } from "./account-store";
import {
  ChesscomClient,
  ChesscomHttpError,
  isAbortError,
  parseProfile,
  parseStats,
  playerPath,
  type FetchLike
} from "./client";
import { firstImportSince, importChesscomGames, type ImportRepository } from "./game-import";

export const NOT_CONNECTED_ERROR = "Connect your chess.com account first.";

export type ChesscomGameStore = ImportRepository & { removeBySource(source: GameSource): number };

export type ChesscomServiceOptions = {
  store: ChesscomAccountStore;
  games: ChesscomGameStore;
  userAgent: string;
  fetch?: FetchLike;
  now?: () => number;
};

export class ChesscomService extends EventEmitter<{ event: [ChesscomEvent] }> {
  private readonly client: ChesscomClient;
  private connectController: AbortController | null = null;
  private sync: Promise<ChesscomSyncResult> | null = null;
  private syncController: AbortController | null = null;
  /** Counts disconnects: a connect that was saving during one undoes its save. */
  private disconnects = 0;
  /** The app is quitting: no import starts. */
  private closed = false;

  constructor(private readonly options: ChesscomServiceOptions) {
    super();
    this.client = new ChesscomClient({ fetch: options.fetch, userAgent: options.userAgent });
  }

  async status(): Promise<ChesscomStatus> {
    return { account: await this.options.store.account(), connecting: this.connecting() };
  }

  /**
   * Looks the username up on chess.com and saves the account (another connected account is
   * replaced), then starts the first import. Rejects with a readable message when there is no such
   * player or chess.com can't be reached. A second call cancels the first.
   */
  async connect(input: ChesscomConnectInput): Promise<ChesscomStatus> {
    this.connectController?.abort();
    const controller = new AbortController();
    this.connectController = controller;
    const disconnects = this.disconnects;
    this.emitStatus();
    try {
      const profile = parseProfile(
        await this.client
          .json(playerPath(input.username), controller.signal)
          .catch((error: unknown) => {
            if (error instanceof ChesscomHttpError && error.status === 404)
              throw new Error(`Chess.com has no player called ${input.username}.`, {
                cause: error
              });
            throw error;
          })
      );
      if (!profile) throw new Error("Chess.com sent a profile the app couldn't read.");
      const ratings = parseStats(
        await this.client.json(playerPath(profile.id, "/stats"), controller.signal)
      );
      controller.signal.throwIfAborted();
      const previous = await this.options.store.account();
      // Another account's import must not carry over.
      if (previous && previous.id !== profile.id) await this.stopSync();
      await this.options.store.save(
        { ...profile, ratings, connectedAt: this.now(), lastSyncAt: null },
        input.firstImport
      );
      // Disconnected while it was being saved: the account mustn't come back.
      if (this.disconnects !== disconnects) {
        await this.options.store.clear();
        return this.status();
      }
    } catch (error) {
      if (isAbortError(error)) return this.status();
      logger.warn("chesscom", "connect failed:", error);
      throw error;
    } finally {
      if (this.connectController === controller) this.connectController = null;
      this.emitStatus();
    }
    // The first import starts right away; its progress and errors arrive as `sync` events.
    void this.syncGames().catch(() => undefined);
    return this.status();
  }

  /** Stops importing and forgets the account; optionally deletes its imported games. */
  async disconnect(options: { removeGames: boolean }): Promise<ChesscomStatus> {
    this.disconnects += 1;
    this.connectController?.abort();
    await this.stopSync();
    await this.options.store.clear();
    if (options.removeGames) this.options.games.removeBySource("chesscom");
    this.emitStatus();
    return this.status();
  }

  /**
   * Reads the account's ratings again and saves them. Null when no account is connected (or it
   * changed meanwhile); rejects when chess.com can't be reached.
   */
  async refreshAccount(): Promise<ChesscomAccount | null> {
    const account = await this.options.store.account();
    if (!account) return null;
    const ratings = parseStats(await this.client.json(playerPath(account.id, "/stats")));
    const saved = await this.options.store.updateRatings(account.id, ratings);
    if (saved) this.emitStatus();
    return saved;
  }

  /** One import at a time: a second call joins the running one. */
  syncGames(): Promise<ChesscomSyncResult> {
    if (!this.sync) {
      this.sync = this.runSync().finally(() => {
        this.sync = null;
      });
    }
    return this.sync;
  }

  /**
   * App quit: stops a connect or an import and waits for the import to end (so nothing is written
   * once the database closes); none starts after. Idempotent.
   */
  async shutdown(): Promise<void> {
    this.closed = true;
    this.connectController?.abort();
    await this.stopSync();
  }

  private async runSync(): Promise<ChesscomSyncResult> {
    if (this.closed) throw new Error("The app is quitting.");
    const controller = new AbortController();
    this.syncController = controller;
    const account = await this.options.store.account();
    if (!account) {
      if (this.syncController === controller) this.syncController = null;
      throw new Error(NOT_CONNECTED_ERROR);
    }
    let imported = 0;
    this.emitEvent({ type: "sync", running: true, imported, error: null });
    try {
      const { firstImport, cursor } = await this.options.store.importState();
      const result = await importChesscomGames({
        client: this.client,
        repository: this.options.games,
        username: account.id,
        cursor,
        since: firstImportSince(firstImport, this.now()),
        signal: controller.signal,
        onProgress: (count) => {
          imported = count;
          this.emitEvent({ type: "sync", running: true, imported, error: null });
        }
      });
      // The cursor belongs to the account that ran the import (another may have connected since).
      if (!(await this.options.store.recordSync(account.id, this.now(), result.nextCursor)))
        throw new Error("The account changed.");
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

  /** Stops a running import and waits for it to end. */
  private async stopSync(): Promise<void> {
    this.syncController?.abort();
    await this.sync?.catch(() => undefined);
  }

  private connecting(): boolean {
    return this.connectController !== null;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private emitEvent(event: ChesscomEvent): void {
    this.emit("event", event);
  }

  private emitStatus(): void {
    void this.status()
      .then((status) => this.emitEvent({ type: "status", status }))
      .catch((error) => logger.error("chesscom", "status read failed:", error));
  }
}
