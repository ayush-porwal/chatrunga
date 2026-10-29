/**
 * The game position index (docs/repertoire-games-and-practice.md §6.1): for the user's games
 * (Lichess, Chess.com and imported games with a user side, `userSideOfGame`), each position of the
 * first 40 moves → the move played from it, with the user's colour and result. Main builds it in
 * the background, a few games at a time, and keeps it current: a game added or changed since it
 * was read (its `updated_at` moved) is read again, a deleted one goes with its rows (foreign keys),
 * and other connected accounts start it over.
 */
import type { SQLInputValue } from "node:sqlite";
import { setImmediate as yieldToEvents, setTimeout as sleep } from "node:timers/promises";
import { userSideOfGame } from "@chaturanga/shared/chess/puzzle-generator";
import { positionKey } from "@chaturanga/shared/chess/repertoire-position";
import { standardCastlingUci } from "@chaturanga/shared/chess/review";
import { parseGameRating } from "@chaturanga/shared/chess/review-rating";
import type { Color } from "@chaturanga/shared/types/chess";
import type { RatingMode } from "@chaturanga/shared/types/ratings";
import type {
  InsightsAccount,
  InsightsFilters
} from "@chaturanga/shared/types/repertoire-insights";
import { getDb } from "../db";
import { retryOnceIfBusy, settingsRepository, transaction } from "../db/repositories";
import { queriesOn } from "../db/rows";
import { parseMoveTree } from "../db/stored-game";
import { errorMessage, logger } from "../logger";
import {
  gameInfoOf,
  INSIGHTS_SOURCES,
  periodStart,
  userResult,
  type GameInfoRow
} from "../repertoire-insights/games";

const { all, get, run } = queriesOn(getDb);

/** The first 40 moves of each game. */
const INDEXED_PLIES = 80;
/** Games read per chunk; the event loop runs between chunks. */
const CHUNK_GAMES = 10;
/** After the index's own write failed (busy past its retry): wait, then carry on. */
const RETRY_MS = 5_000;
/** The connected accounts the index was built for (lower case, sorted). */
const USERNAMES_KEY = "main.repertoireExplorer.indexUsernames";

const SOURCE_PLACEHOLDERS = INSIGHTS_SOURCES.map(() => "?").join(", ");

/** A library game as the index reads it: what Insights reads, and its moves. */
type StoredGame = GameInfoRow & { pgn: string; move_tree_json: string; updated_at: number };

/** What the index keeps of one game: its facts, and its moves when it has a user side. */
type IndexedGame = {
  gameId: string;
  updatedAt: number;
  userColor: Color | null;
  account: InsightsAccount;
  timeControl: RatingMode;
  rated: boolean;
  userRating: number | null;
  playedAt: number | null;
  result: "win" | "draw" | "loss" | null;
  moves: { ply: number; positionKey: string; uci: string }[];
};

/**
 * Reads one stored game for the index (its facts as Insights reads them, `gameInfoOf`). A game
 * without a user side keeps its facts only (so it isn't read again until it changes); so does one
 * whose moves can't be read. Null for a game that isn't one of the user's sources.
 */
function indexGame(game: StoredGame, usernames: readonly string[]): IndexedGame | null {
  const info = gameInfoOf(game);
  if (!info) return null;
  const userColor = userSideOfGame(game, usernames);
  const indexed: IndexedGame = {
    gameId: game.id,
    updatedAt: game.updated_at,
    userColor,
    account: info.account,
    timeControl: info.timeControl,
    rated: info.rated,
    userRating: userColor
      ? parseGameRating(userColor === "white" ? info.headers.whiteElo : info.headers.blackElo)
      : null,
    playedAt: info.playedAt,
    result: userColor ? userResult(info.headers, userColor) : null,
    moves: []
  };
  if (!userColor) return indexed;
  try {
    const { moveTree } = parseMoveTree(game);
    const byId = new Map(moveTree.map((node) => [node.id, node]));
    let node = moveTree.find((item) => item.parentId === null);
    for (let ply = 1; ply <= INDEXED_PLIES; ply += 1) {
      const next = node?.children[0] ? byId.get(node.children[0]) : undefined;
      if (!next?.uci) break;
      indexed.moves.push({
        ply,
        positionKey: positionKey(next.fenBefore),
        uci: standardCastlingUci(next.fenBefore, next.uci)
      });
      node = next;
    }
  } catch (error) {
    logger.warn("repertoire-explorer", `game ${game.id} can't be indexed:`, errorMessage(error));
    indexed.moves = [];
  }
  return indexed;
}

/** The Insights filters as SQL on `game_position_games g` (`passesFilters`' rules). */
function filterSql(
  filters: InsightsFilters,
  now: number
): { where: string; params: SQLInputValue[] } {
  const params: SQLInputValue[] = [];
  const list = (values: readonly string[]) => {
    params.push(...values);
    return values.map(() => "?").join(", ") || "NULL";
  };
  const clauses = [
    `g.time_control IN (${list(filters.timeControls)})`,
    `g.account IN (${list(filters.accounts)})`
  ];
  const start = periodStart(filters, now);
  if (start !== null) {
    clauses.push("g.played_at >= ?");
    params.push(start);
  }
  if (filters.ratedOnly) clauses.push("g.rated = 1");
  return { where: clauses.join(" AND "), params };
}

/** One move's tally at a position: games (each counted once), W/D/L, last played. */
type PositionMoveRow = {
  uci: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  lastPlayedAt: number | null;
};

export const gamePositionIndex = {
  /**
   * Starts the index over when the connected accounts changed (each game's user side may differ).
   * Whether it did.
   */
  syncUsernames(usernames: readonly string[]): boolean {
    const names = [...new Set(usernames.map((name) => name.trim().toLowerCase()))]
      .filter(Boolean)
      .sort()
      .join("\n");
    const stored = settingsRepository.getMain(USERNAMES_KEY);
    if (stored === names) return false;
    transaction(() => {
      run("DELETE FROM game_position_moves");
      run("DELETE FROM game_position_games");
      settingsRepository.setMain(USERNAMES_KEY, names);
    });
    return true;
  },

  /** Games not read yet, or changed since (newest first), `limit` of them. */
  staleGames(limit: number): StoredGame[] {
    return all<StoredGame>(
      `SELECT g.id, g.source, g.white, g.black, g.event, g.site, g.result, g.date, g.headers_json,
        g.pgn, g.move_tree_json, g.created_at, g.updated_at
      FROM games g LEFT JOIN game_position_games i ON i.game_id = g.id
      WHERE g.source IN (${SOURCE_PLACEHOLDERS})
        AND (i.game_id IS NULL OR i.game_updated_at != g.updated_at)
      ORDER BY g.updated_at DESC, g.id LIMIT ?`,
      ...INSIGHTS_SOURCES,
      limit
    );
  },

  /** The user's games read so far (and current), of all. */
  progress(): { done: number; total: number } {
    const row = get<{ total: number; done: number | null }>(
      `SELECT COUNT(*) AS total, SUM(i.game_updated_at = g.updated_at) AS done
      FROM games g LEFT JOIN game_position_games i ON i.game_id = g.id
      WHERE g.source IN (${SOURCE_PLACEHOLDERS})`,
      ...INSIGHTS_SOURCES
    );
    return { done: row?.done ?? 0, total: row?.total ?? 0 };
  },

  /** Stores games as read (each replaces what the index had of it); a deleted game is skipped. */
  write(games: readonly IndexedGame[]): void {
    transaction(() => {
      for (const game of games) {
        if (!get<{ found: number }>("SELECT 1 AS found FROM games WHERE id = ?", game.gameId))
          continue;
        run("DELETE FROM game_position_moves WHERE game_id = ?", game.gameId);
        run(
          `INSERT INTO game_position_games
            (game_id, game_updated_at, user_color, account, time_control, rated, user_rating,
            played_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(game_id) DO UPDATE SET
            game_updated_at = excluded.game_updated_at, user_color = excluded.user_color,
            account = excluded.account, time_control = excluded.time_control, rated = excluded.rated,
            user_rating = excluded.user_rating, played_at = excluded.played_at`,
          game.gameId,
          game.updatedAt,
          game.userColor,
          game.account,
          game.timeControl,
          Number(game.rated),
          game.userRating,
          game.playedAt
        );
        if (!game.userColor) continue;
        for (const move of game.moves) {
          run(
            `INSERT INTO game_position_moves
              (position_key, game_id, ply, move_uci, user_color, result, played_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            move.positionKey,
            game.gameId,
            move.ply,
            move.uci,
            game.userColor,
            game.result,
            game.playedAt
          );
        }
      }
    });
  },

  /**
   * The moves played from a position in the user's games that `filter` lets in, most games first.
   * A game that reaches the position more than once counts its first visit.
   */
  moves(key: string, filters: InsightsFilters, now: number): PositionMoveRow[] {
    const { where, params } = filterSql(filters, now);
    return all<{
      move_uci: string;
      games: number;
      wins: number;
      draws: number;
      losses: number;
      last_played: number;
    }>(
      `SELECT m.move_uci, COUNT(*) AS games,
        COUNT(CASE WHEN m.result = 'win' THEN 1 END) AS wins,
        COUNT(CASE WHEN m.result = 'draw' THEN 1 END) AS draws,
        COUNT(CASE WHEN m.result = 'loss' THEN 1 END) AS losses, MAX(m.played_at) AS last_played
      FROM game_position_moves m JOIN game_position_games g ON g.game_id = m.game_id
      WHERE m.position_key = ? AND ${where}
        AND m.ply = (SELECT MIN(x.ply) FROM game_position_moves x
          WHERE x.game_id = m.game_id AND x.position_key = m.position_key)
      GROUP BY m.move_uci
      ORDER BY games DESC, last_played DESC, m.move_uci`,
      key,
      ...params
    ).map((row) => ({
      uci: row.move_uci,
      games: row.games,
      wins: row.wins,
      draws: row.draws,
      losses: row.losses,
      lastPlayedAt: row.last_played
    }));
  },

  /** The mode the user has played most games at (null: no games with a user side). */
  mostPlayedMode(): RatingMode | null {
    return (
      get<{ time_control: RatingMode }>(
        `SELECT time_control FROM game_position_games WHERE user_color IS NOT NULL
        GROUP BY time_control ORDER BY COUNT(*) DESC, time_control LIMIT 1`
      )?.time_control ?? null
    );
  },

  /** The user's rating in their `limit` latest games at `mode` that carry one, newest first. */
  recentRatings(mode: RatingMode, limit: number): number[] {
    return all<{ user_rating: number }>(
      `SELECT user_rating FROM game_position_games
      WHERE user_color IS NOT NULL AND time_control = ? AND user_rating IS NOT NULL
      ORDER BY played_at IS NULL, played_at DESC LIMIT ?`,
      mode,
      limit
    ).map((row) => row.user_rating);
  }
};

type GamePositionIndexerDeps = {
  /**
   * The connected Lichess and Chess.com usernames; null when an account couldn't be read (the
   * pass is skipped: reading it as disconnected would start the index over without that account).
   */
  usernames(): Promise<string[] | null>;
  /** A chunk was stored (the explorer's counts may have grown). */
  onChunk?(): void;
};

/**
 * Builds the index in the background: one pass over the games not read yet (or changed), a chunk
 * at a time, yielding to the event loop between chunks. A kick while a pass runs makes it look
 * again once it ends.
 */
export class GamePositionIndexer {
  private pass: Promise<void> | null = null;
  private kickAgain = false;
  private stopped = false;

  constructor(private readonly deps: GamePositionIndexerDeps) {}

  /** Starts a pass (or another once the running one ends). */
  kick(): void {
    if (this.stopped) return;
    if (this.pass) {
      this.kickAgain = true;
      return;
    }
    this.pass = this.build()
      .catch(async (error: unknown) => {
        // Busy past its retry (an import holds the lock): carry on shortly.
        logger.warn("repertoire-explorer", "indexing games stopped:", errorMessage(error));
        await sleep(RETRY_MS, undefined, { ref: false });
        this.kickAgain = true;
      })
      .finally(() => {
        this.pass = null;
        if (!this.kickAgain) return;
        this.kickAgain = false;
        this.kick();
      });
  }

  /** Resolves once no pass is running (tests, and quitting). */
  async idle(): Promise<void> {
    while (this.pass) await this.pass;
  }

  stop(): void {
    this.stopped = true;
  }

  private async build(): Promise<void> {
    const usernames = await this.deps.usernames();
    if (!usernames) {
      logger.warn("repertoire-explorer", "a connected account couldn't be read; indexing later");
      return;
    }
    await retryOnceIfBusy(() => gamePositionIndex.syncUsernames(usernames));
    while (!this.stopped) {
      const games = gamePositionIndex.staleGames(CHUNK_GAMES);
      if (!games.length) return;
      const indexed = games
        .map((game) => indexGame(game, usernames))
        .filter((game) => game !== null);
      await retryOnceIfBusy(() => gamePositionIndex.write(indexed));
      this.deps.onChunk?.();
      await yieldToEvents();
    }
  }
}
