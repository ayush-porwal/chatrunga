/**
 * Insights' background comparer (docs/repertoire-games-and-practice.md §5.1, §5.4). Each pass
 * compares the user's games with every repertoire of their colour, but only the (game,
 * repertoire) pairs whose stamp changed: the game's row (its fingerprint and last change), its
 * latest review, the user's side, the repertoire's revision, or the algorithm version. A game's
 * opening moves are kept in memory per stamp, so a repertoire edit compares again without reading
 * the games; a review is read only for a game that left the book. It works in chunks of a few
 * milliseconds that yield to the event loop, and writes each chunk in one transaction behind the
 * repertoire write gate (game misses change practice progress). Kicks while a pass runs start one
 * more after it.
 */
import { performance } from "node:perf_hooks";
import { setImmediate as nextTurn, setTimeout as sleep } from "node:timers/promises";
import { userSideOfGame } from "@chaturanga/shared/chess/puzzle-generator";
import { repertoireComparer, type ComparedGame } from "@chaturanga/shared/chess/repertoire-compare";
import { scheduleAfterOutcome } from "@chaturanga/shared/chess/repertoire-scheduler";
import type { Color } from "@chaturanga/shared/types/chess";
import type { RepertoireComparison } from "@chaturanga/shared/types/repertoire";
import type { InsightsComparerStatus } from "@chaturanga/shared/types/repertoire-insights";
import { getDb } from "../db";
import { mainlineUcis } from "../db/game-fingerprint";
import { transaction } from "../db/repositories";
import { queriesOn } from "../db/rows";
import { parseMoveTree } from "../db/stored-game";
import { errorMessage, logger } from "../logger";
import { stripFingerprint } from "../repertoire/core";
import {
  chapterRepository,
  decisionRepository,
  progressRepository
} from "../repertoire/repository";
import { parseStoredJson } from "../stored-json";
import { gameInfoOf, INSIGHTS_SOURCES, type GameInfoRow } from "./games";
import {
  bestRecord,
  COMPARED_PLIES,
  firstMoves,
  INSIGHTS_ALGO_VERSION,
  leftAtFirstMoves,
  outcomeRecord,
  reviewedMoves,
  uncomparedRecord,
  type ComparedGameInput
} from "./outcomes";
import { insightsRepository, type OutcomeRecord, type OutcomeStamp } from "./repository";

const { all, get } = queriesOn(getDb);

/** At most this many games per chunk (one transaction; then the event loop runs)… */
const CHUNK = 20;
/** …and no more once comparing the chunk took this long, so a chunk stays well under a frame. */
const CHUNK_BUDGET_MS = 6;
/** A slip in a game older than this doesn't change the schedule (§5.4). */
const MISS_WINDOW_MS = 30 * 24 * 60 * 60_000;
/** After a pass failed (the database busy past its retry, say): wait, then try again. */
const RETRY_MS = 5_000;
/** How long quitting waits for the chunk being written. */
const STOP_WAIT_MS = 3_000;

type InsightsComparerDeps = {
  /**
   * The connected Lichess and Chess.com usernames; null when an account couldn't be read (the
   * pass is skipped: reading it as disconnected would rewrite every game as having no user side).
   */
  usernames(): Promise<string[] | null>;
  emit(status: InsightsComparerStatus): void;
  /** Game misses changed this repertoire's practice progress. */
  progressChanged(repertoireId: string): void;
  /** Runs a write once the repertoire writes admitted before it are done. */
  write<T>(work: () => T): Promise<T>;
  now?: () => number;
  /** Resolves on a later turn of the event loop. */
  yieldTurn?: () => Promise<void>;
  /** Resolves after `ms`; rejects once `signal` aborts. */
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
};

type RepertoireRef = { id: string; color: Color; revision: number; createdAt: number };

type Prepared = {
  revision: number;
  /** Null when the repertoire's chapters can't be read (until its next revision). */
  compare: ((game: Omit<ComparedGame, "color">) => RepertoireComparison) | null;
};

/** A game whose rows are out of date, and the repertoires to compare it with. */
type Work = {
  row: GameRow;
  side: Color | null;
  hash: string;
  playedAt: number | null;
  /** The repertoires the game has rows for afterwards (null: none applies). */
  expected: (string | null)[];
  stale: (string | null)[];
  /** What a failed comparison of these stale pairs is remembered by (see `failed`). */
  failKey: string;
};

/** The cheap columns of a game: no PGN, no move tree. */
type GameRow = GameInfoRow & {
  initial_fen: string | null;
  fingerprint: string | null;
  updated_at: number;
};

/** A game's root and opening moves (UCI, space-separated: small to keep for every game). */
type Mainline = { stamp: string; rootFen: string; moves: string };

/** Of every stored stamp of a game, whether the one for `repertoireId` is current. */
function isCurrent(
  stamps: readonly OutcomeStamp[] | undefined,
  repertoireId: string | null,
  hash: string,
  revision: number
): boolean {
  return Boolean(
    stamps?.some(
      (stamp) =>
        stamp.repertoireId === repertoireId &&
        stamp.gameHash === hash &&
        stamp.revision === revision &&
        stamp.algoVersion === INSIGHTS_ALGO_VERSION
    )
  );
}

/** A slip at a decision (not at the very first moves) in a game of the last 30 days, or null. */
function recentSlip(record: OutcomeRecord, now: number) {
  const { repertoireId, positionKey, playedAt } = record;
  if (record.outcome !== "forgot" || !repertoireId || !positionKey || playedAt === null)
    return null;
  if (leftAtFirstMoves(record) || playedAt < now - MISS_WINDOW_MS) return null;
  return { repertoireId, positionKey, playedAt };
}

export class InsightsComparer {
  private stopped = false;
  private loop: Promise<void> | null = null;
  private again = false;
  private current: InsightsComparerStatus = { running: false, done: 0, total: 0 };
  private readonly prepared = new Map<string, Prepared>();
  /** Each game's opening as last read, by game id (read again when its stamp changes). */
  private readonly mainlines = new Map<string, Mainline>();
  /**
   * Games whose moves couldn't be read, or whose comparison failed, by game id: the stamp and
   * revisions they failed at. They aren't compared again until one of those changes.
   */
  private readonly failed = new Map<string, string>();
  private readonly stopping = new AbortController();
  private readonly now: () => number;
  private readonly yieldTurn: () => Promise<void>;
  private readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;

  constructor(private readonly deps: InsightsComparerDeps) {
    this.now = deps.now ?? Date.now;
    this.yieldTurn = deps.yieldTurn ?? (() => nextTurn());
    this.wait = deps.wait ?? ((ms, signal) => sleep(ms, undefined, { signal }));
  }

  status(): InsightsComparerStatus {
    return this.current;
  }

  /** Read anew after every await (quitting may have begun meanwhile). */
  private isStopped(): boolean {
    return this.stopped;
  }

  /** Starts a pass, or one more after the running one. Resolves when the passes are done. */
  kick(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.loop) {
      this.again = true;
      return this.loop;
    }
    this.loop = this.passes().finally(() => {
      this.loop = null;
    });
    return this.loop;
  }

  /** Quitting: the pass stops after the chunk being written, and nothing more starts. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.stopping.abort(new Error("The app is closing."));
    const loop = this.loop;
    if (loop)
      await Promise.race([
        loop,
        new Promise((resolve) => setTimeout(resolve, STOP_WAIT_MS).unref())
      ]);
  }

  private async passes(): Promise<void> {
    do {
      this.again = false;
      try {
        await this.pass();
      } catch (error) {
        logger.warn(
          "repertoire-insights",
          "comparing games failed; trying again shortly:",
          errorMessage(error)
        );
        this.setStatus({ running: false, done: 0, total: 0 });
        try {
          await this.wait(RETRY_MS, this.stopping.signal);
        } catch {
          return;
        }
        this.again = true;
      }
    } while (this.again && !this.stopped);
  }

  private setStatus(status: InsightsComparerStatus): void {
    this.current = status;
    if (!this.stopped) this.deps.emit(status);
  }

  /** The active repertoires, first created first. */
  private repertoires(): RepertoireRef[] {
    return all<{ id: string; color: string; revision: number; created_at: number }>(
      "SELECT id, color, revision, created_at FROM repertoires WHERE archived_at IS NULL ORDER BY created_at, id"
    ).map((row) => ({
      id: row.id,
      color: row.color === "black" ? "black" : "white",
      revision: row.revision,
      createdAt: row.created_at
    }));
  }

  private async pass(): Promise<void> {
    const usernames = await this.deps.usernames();
    if (this.stopped) return;
    if (!usernames) {
      logger.warn("repertoire-insights", "a connected account couldn't be read; comparing later");
      if (this.current.running) this.setStatus({ running: false, done: 0, total: 0 });
      return;
    }
    const repertoires = this.repertoires();
    for (const id of this.prepared.keys()) {
      if (!repertoires.some((item) => item.id === id)) this.prepared.delete(id);
    }
    const work = this.staleGames(usernames, repertoires);
    if (!work.length) {
      if (this.current.running) this.setStatus({ running: false, done: 0, total: 0 });
      return;
    }
    const createdAt = new Map(repertoires.map((item) => [item.id, item.createdAt]));
    const revisions = new Map(repertoires.map((item) => [item.id, item.revision]));
    let done = 0;
    this.setStatus({ running: true, done, total: work.length });
    while (done < work.length) {
      if (this.isStopped()) return;
      const now = this.now();
      const chunk: { item: Work; records: OutcomeRecord[] }[] = [];
      const started = performance.now();
      while (
        done + chunk.length < work.length &&
        chunk.length < CHUNK &&
        (!chunk.length || performance.now() - started < CHUNK_BUDGET_MS)
      ) {
        const item = work[done + chunk.length];
        chunk.push({ item, records: this.compareGame(item, revisions, now) });
      }
      const changed = await this.deps.write(() =>
        transaction(() => {
          const touched = new Set<string>();
          for (const { item, records } of chunk) {
            insightsRepository.saveGame(item.row.id, records, item.expected);
            const best = bestRecord(
              insightsRepository.forGame(item.row.id),
              (id) => createdAt.get(id) ?? Number.MAX_SAFE_INTEGER
            );
            const repertoireId = best && this.applyMiss(best, now);
            if (repertoireId) touched.add(repertoireId);
          }
          return touched;
        })
      );
      for (const repertoireId of changed) this.deps.progressChanged(repertoireId);
      done += chunk.length;
      this.setStatus({ running: done < work.length, done, total: work.length });
      await this.yieldTurn();
    }
  }

  /** The user's games whose rows are out of date. */
  private staleGames(usernames: readonly string[], repertoires: readonly RepertoireRef[]): Work[] {
    const stamps = insightsRepository.stamps();
    const reviews = new Map(
      all<{ game_id: string; review_id: string }>(
        `SELECT game_id, review_id FROM game_reviews r WHERE created_at = (
          SELECT MAX(created_at) FROM game_reviews WHERE game_id = r.game_id)`
      ).map((row) => [row.game_id, row.review_id])
    );
    const rows = all<GameRow>(
      `SELECT id, source, white, black, event, site, result, date, headers_json, created_at,
        initial_fen, fingerprint, updated_at FROM games
        WHERE source IN (${INSIGHTS_SOURCES.map(() => "?").join(", ")})
        ORDER BY created_at DESC, id`,
      ...INSIGHTS_SOURCES
    );
    const present = new Set<string>();
    const work: Work[] = [];
    for (const row of rows) {
      const item = this.gameWork(row, { usernames, repertoires, stamps, reviews });
      if (item !== undefined) present.add(row.id);
      if (item) work.push(item);
    }
    for (const id of this.mainlines.keys()) if (!present.has(id)) this.mainlines.delete(id);
    for (const id of this.failed.keys()) if (!present.has(id)) this.failed.delete(id);
    return work;
  }

  /**
   * One game's out-of-date pairs: null when its rows are current (or it failed at this stamp),
   * undefined for a game that isn't one of the user's.
   */
  private gameWork(
    row: GameRow,
    pass: {
      usernames: readonly string[];
      repertoires: readonly RepertoireRef[];
      stamps: ReadonlyMap<string, OutcomeStamp[]>;
      /** Each game's latest review id. */
      reviews: ReadonlyMap<string, string>;
    }
  ): Work | null | undefined {
    const { repertoires, reviews } = pass;
    const info = gameInfoOf(row);
    if (!info) return undefined;
    const own = pass.stamps.get(row.id);
    const side = userSideOfGame(row, pass.usernames);
    // Any change to the game's row moves `updated_at`; a new review gets a new id.
    const hash = `${row.updated_at}:${row.fingerprint ?? ""}:${side ?? ""}:${reviews.get(row.id) ?? ""}`;
    const revisionOf = (id: string | null) =>
      id === null ? 0 : repertoires.find((item) => item.id === id)!.revision;
    const ofColor = side ? repertoires.filter((item) => item.color === side) : [];
    const expected: (string | null)[] = ofColor.length ? ofColor.map((item) => item.id) : [null];
    const stale = expected.filter((id) => !isCurrent(own, id, hash, revisionOf(id)));
    const extra = own?.some((stamp) => !expected.includes(stamp.repertoireId)) ?? false;
    const failKey = [hash, ...stale.map((id) => `${id ?? ""}@${revisionOf(id)}`)].join("|");
    if (!extra && (!stale.length || this.failed.get(row.id) === failKey)) return null;
    return { row, side, hash, playedAt: info.playedAt, expected, stale, failKey };
  }

  /**
   * The new rows of one game (its stale pairs). A game whose moves can't be read, or a pair that
   * can't be compared, is remembered as failed at this stamp (and left out until it changes).
   */
  private compareGame(item: Work, revisions: Map<string, number>, now: number): OutcomeRecord[] {
    const { row, side, hash, playedAt } = item;
    const base = { id: row.id, hash, playedAt, rootFen: row.initial_fen ?? "" };
    this.failed.delete(row.id);
    if (!side) return [uncomparedRecord({ ...base, color: null }, "no-user-side", now)];
    if (!item.stale.length) return [];
    const failed = (error: unknown) => {
      logger.warn("repertoire-insights", `game ${row.id} can't be compared:`, errorMessage(error));
      this.failed.set(row.id, item.failKey);
    };
    const game = this.mainline(row, hash);
    if (!game) {
      failed(new Error("its moves can't be read"));
      return [];
    }
    if (item.stale[0] === null) {
      const opening = firstMoves(game.rootFen, game.moves, 2);
      return [uncomparedRecord({ ...base, ...game, color: side }, "no-repertoire", now, opening)];
    }
    const input: ComparedGameInput = { ...base, ...game, color: side };
    // Read only for a game that left the book (the after-book loss), once.
    let review: ReturnType<typeof reviewedMoves> | undefined;
    const reviewOf = () => (review ??= reviewedMoves(this.latestReview(row.id)));
    const records: OutcomeRecord[] = [];
    for (const repertoireId of item.stale) {
      if (repertoireId === null) continue;
      const compare = this.comparerFor(repertoireId, side, revisions.get(repertoireId) ?? 0);
      try {
        if (!compare) throw new Error(`repertoire ${repertoireId} can't be read`);
        records.push(outcomeRecord(input, compare(input), reviewOf, now));
      } catch (error) {
        failed(error);
      }
    }
    return records;
  }

  /**
   * A game's opening: its root and main line (the first compared plies), read once per stamp;
   * null when damaged.
   */
  private mainline(row: GameRow, stamp: string): { rootFen: string; moves: string[] } | null {
    let line = this.mainlines.get(row.id);
    if (line?.stamp !== stamp) {
      this.mainlines.delete(row.id);
      const stored = get<{ move_tree_json: string; pgn: string }>(
        "SELECT move_tree_json, pgn FROM games WHERE id = ?",
        row.id
      );
      if (!stored) return null;
      try {
        const { moveTree } = parseMoveTree(stored);
        const root = moveTree.find((node) => node.parentId === null);
        line = {
          stamp,
          rootFen: row.initial_fen ?? root?.fenAfter ?? "",
          moves: mainlineUcis(moveTree).slice(0, COMPARED_PLIES).join(" ")
        };
      } catch {
        return null;
      }
      this.mainlines.set(row.id, line);
    }
    return { rootFen: line.rootFen, moves: line.moves ? line.moves.split(" ") : [] };
  }

  private latestReview(gameId: string): unknown {
    const row = get<{ review_json: string }>(
      "SELECT review_json FROM game_reviews WHERE game_id = ? ORDER BY created_at DESC LIMIT 1",
      gameId
    );
    if (!row) return null;
    try {
      return parseStoredJson<unknown>(row.review_json);
    } catch {
      return null;
    }
  }

  /** The repertoire, indexed once per revision; null when its chapters can't be read. */
  private comparerFor(repertoireId: string, color: Color, revision: number) {
    const cached = this.prepared.get(repertoireId);
    if (cached?.revision === revision) return cached.compare;
    let compare: Prepared["compare"] = null;
    try {
      compare = repertoireComparer(color, {
        id: repertoireId,
        name: "",
        revision,
        chapters: chapterRepository.list(repertoireId).filter((chapter) => chapter.enabled),
        decisions: decisionRepository.list(repertoireId).map(stripFingerprint)
      });
    } catch (error) {
      logger.warn(
        "repertoire-insights",
        `repertoire ${repertoireId} can't be compared:`,
        errorMessage(error)
      );
    }
    this.prepared.set(repertoireId, { revision, compare });
    return compare;
  }

  /**
   * A slip in a recent game sends its decision back to the start (§5.4): once per (game,
   * repertoire, position), for a decision that isn't paused, was accepted before the game, and
   * was practised before it. The miss counts as an attempt (its time is the decision's last
   * attempt), so a game played before it — another game of the same pass, a later sync's older
   * game, a game synced again after its account reconnected — changes nothing. Returns the
   * repertoire whose progress changed.
   */
  private applyMiss(record: OutcomeRecord, now: number): string | null {
    const slip = recentSlip(record, now);
    if (!slip) return null;
    const { repertoireId, positionKey, playedAt } = slip;
    const { gameId } = record;
    const decision = insightsRepository.decisionForMiss(repertoireId, positionKey);
    if (!decision || decision.paused || !decision.fingerprint) return null;
    if (decision.acceptedAt === null || playedAt <= decision.acceptedAt) return null;
    const previous = progressRepository.get(repertoireId, positionKey);
    if (previous?.lastAttemptAt == null || playedAt <= previous.lastAttemptAt) return null;
    if (insightsRepository.hasMiss(gameId, repertoireId, positionKey)) return null;
    insightsRepository.addMiss(gameId, repertoireId, positionKey, now);
    const schedule = scheduleAfterOutcome(previous, "wrong", now, previous.lastAttemptAt);
    if (!schedule) return null;
    progressRepository.upsert({
      repertoireId,
      positionKey,
      ...schedule,
      acceptanceFingerprint: decision.fingerprint,
      suspended: false
    });
    return repertoireId;
  }
}
