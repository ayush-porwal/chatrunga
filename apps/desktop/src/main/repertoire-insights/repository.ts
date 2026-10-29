/**
 * Insights storage (migration 17, migration.ts): the compared (game, repertoire) rows, the game
 * misses already applied, and the saved filters. Stored JSON is checked as it is read back: a
 * damaged row reads as having no moves.
 */
import type { Color } from "@chaturanga/shared/types/chess";
import { isOneOf, isRecord } from "@chaturanga/shared/types/guards";
import { RATING_MODES } from "@chaturanga/shared/types/ratings";
import {
  DEFAULT_INSIGHTS_FILTERS,
  INSIGHTS_ACCOUNTS,
  INSIGHTS_PERIODS,
  type InsightsFilters
} from "@chaturanga/shared/types/repertoire-insights";
import { getDb } from "../db";
import { settingsRepository } from "../db/repositories";
import { queriesOn } from "../db/rows";
import { stringArray } from "../repertoire/columns";
import { INSIGHTS_SOURCES, type GameInfoRow } from "./games";

const { all, get, run } = queriesOn(getDb);

const FILTERS_KEY = "main.repertoireInsights.filters";

/** What a comparison of one game with one repertoire came to, as stored. */
const STORED_OUTCOMES = [
  "forgot",
  "new-reply",
  "ended-in-book",
  "in-book",
  "not-covered",
  "no-repertoire",
  "no-user-side"
] as const;
export type StoredOutcome = (typeof STORED_OUTCOMES)[number];

/** One move of a stored game line: UCI, SAN, and the position key before it. */
export type StoredMove = { uci: string; san: string; key: string };

export type OutcomeRecord = {
  gameId: string;
  /** Null for a game without a user side or without a repertoire of its colour. */
  repertoireId: string | null;
  color: Color | null;
  outcome: StoredOutcome;
  /** The ply of the move the outcome is about (none for `in-book` and the uncompared). */
  ply: number | null;
  positionKey: string | null;
  playedUci: string | null;
  expectedUcis: string[];
  chapterId: string | null;
  matchedPlies: number;
  /** The game's moves up to and including that move (all of them, up to the compared plies, else). */
  moves: StoredMove[];
  rootFen: string | null;
  playedAt: number | null;
  afterBookLoss: number | null;
  gameHash: string;
  revision: number;
  algoVersion: number;
  comparedAt: number;
};

/** What a stored row was computed from (the comparer's staleness check). */
export type OutcomeStamp = Pick<
  OutcomeRecord,
  "repertoireId" | "gameHash" | "revision" | "algoVersion"
>;

type OutcomeRow = {
  game_id: string;
  repertoire_id: string | null;
  color: string | null;
  outcome: string;
  ply: number | null;
  position_key: string | null;
  played_uci: string | null;
  expected_ucis_json: string;
  chapter_id: string | null;
  matched_plies: number;
  moves_json: string;
  root_fen: string | null;
  played_at: number | null;
  after_book_loss: number | null;
  game_hash: string;
  revision: number;
  algo_version: number;
  compared_at: number;
};

/** A stored row with the facts of its game and the creation time of its repertoire. */
export type OutcomeWithGame = OutcomeRecord & {
  game: GameInfoRow;
  repertoireName: string | null;
  repertoireCreatedAt: number | null;
};

function storedMoves(text: string): StoredMove[] {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    const moves: StoredMove[] = [];
    for (const item of parsed) {
      if (!Array.isArray(item) || item.length !== 3) return [];
      const [uci, san, key] = item as unknown[];
      if (typeof uci !== "string" || typeof san !== "string" || typeof key !== "string") return [];
      moves.push({ uci, san, key });
    }
    return moves;
  } catch {
    return [];
  }
}

function toRecord(row: OutcomeRow): OutcomeRecord {
  return {
    gameId: row.game_id,
    repertoireId: row.repertoire_id,
    color: row.color === "white" || row.color === "black" ? row.color : null,
    outcome: isOneOf(STORED_OUTCOMES, row.outcome) ? row.outcome : "not-covered",
    ply: row.ply,
    positionKey: row.position_key,
    playedUci: row.played_uci,
    expectedUcis: stringArray(row.expected_ucis_json),
    chapterId: row.chapter_id,
    matchedPlies: row.matched_plies,
    moves: storedMoves(row.moves_json),
    rootFen: row.root_fen,
    playedAt: row.played_at,
    afterBookLoss: row.after_book_loss,
    gameHash: row.game_hash,
    revision: row.revision,
    algoVersion: row.algo_version,
    comparedAt: row.compared_at
  };
}

const placeholders = (values: readonly unknown[]) => values.map(() => "?").join(", ");

/** Filters read back: known members only, a missing or damaged value from the defaults. */
function parseFilters(value: unknown): InsightsFilters {
  if (!isRecord(value)) return { ...DEFAULT_INSIGHTS_FILTERS };
  const members = <T extends string>(items: unknown, known: readonly T[], fallback: T[]): T[] =>
    Array.isArray(items) ? known.filter((item) => items.includes(item)) : [...fallback];
  const period = isOneOf(INSIGHTS_PERIODS, value.period) ? value.period : "all";
  const since =
    typeof value.since === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.since) ? value.since : null;
  return {
    period: period === "since" && !since ? "all" : period,
    since: period === "since" ? since : null,
    timeControls: members(value.timeControls, RATING_MODES, DEFAULT_INSIGHTS_FILTERS.timeControls),
    ratedOnly: value.ratedOnly === true,
    accounts: members(value.accounts, INSIGHTS_ACCOUNTS, DEFAULT_INSIGHTS_FILTERS.accounts)
  };
}

export const insightsRepository = {
  filters(): InsightsFilters {
    return parseFilters(settingsRepository.getMain(FILTERS_KEY));
  },

  setFilters(filters: InsightsFilters): InsightsFilters {
    const parsed = parseFilters(filters);
    settingsRepository.setMain(FILTERS_KEY, parsed);
    return parsed;
  },

  /** Every stored row's stamp, by game. */
  stamps(): Map<string, OutcomeStamp[]> {
    const stamps = new Map<string, OutcomeStamp[]>();
    for (const row of all<
      Pick<OutcomeRow, "game_id" | "repertoire_id" | "game_hash" | "revision" | "algo_version">
    >(
      "SELECT game_id, repertoire_id, game_hash, revision, algo_version FROM repertoire_game_outcomes"
    )) {
      const stamp = {
        repertoireId: row.repertoire_id,
        gameHash: row.game_hash,
        revision: row.revision,
        algoVersion: row.algo_version
      };
      const list = stamps.get(row.game_id);
      if (list) list.push(stamp);
      else stamps.set(row.game_id, [stamp]);
    }
    return stamps;
  },

  /** A game's stored rows. */
  forGame(gameId: string): OutcomeRecord[] {
    return all<OutcomeRow>("SELECT * FROM repertoire_game_outcomes WHERE game_id = ?", gameId).map(
      toRecord
    );
  },

  /**
   * Stores a game's rows for the repertoires in `records` and drops its rows for any repertoire
   * not in `keep` (the caller runs it in a transaction).
   */
  saveGame(gameId: string, records: readonly OutcomeRecord[], keep: readonly (string | null)[]) {
    const kept = keep.map((id) => id ?? "");
    run(
      `DELETE FROM repertoire_game_outcomes WHERE game_id = ?
        AND COALESCE(repertoire_id, '') NOT IN (${placeholders(kept)})`,
      gameId,
      ...kept
    );
    for (const record of records) {
      run(
        "DELETE FROM repertoire_game_outcomes WHERE game_id = ? AND COALESCE(repertoire_id, '') = ?",
        gameId,
        record.repertoireId ?? ""
      );
      run(
        `INSERT INTO repertoire_game_outcomes (game_id, repertoire_id, color, outcome, ply,
          position_key, played_uci, expected_ucis_json, chapter_id, matched_plies, moves_json,
          root_fen, played_at, after_book_loss, game_hash, revision, algo_version, compared_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        record.gameId,
        record.repertoireId,
        record.color,
        record.outcome,
        record.ply,
        record.positionKey,
        record.playedUci,
        JSON.stringify(record.expectedUcis),
        record.chapterId,
        record.matchedPlies,
        JSON.stringify(record.moves.map((move) => [move.uci, move.san, move.key])),
        record.rootFen,
        record.playedAt,
        record.afterBookLoss,
        record.gameHash,
        record.revision,
        record.algoVersion,
        record.comparedAt
      );
    }
  },

  /** Every stored row with its game's facts (`repertoireId`: that repertoire's rows only). */
  withGames(repertoireId: string | null = null): OutcomeWithGame[] {
    const rows = all<
      OutcomeRow & {
        id: string;
        source: string;
        white: string | null;
        black: string | null;
        event: string | null;
        site: string | null;
        result: string | null;
        date: string | null;
        headers_json: string | null;
        created_at: number;
        repertoire_name: string | null;
        repertoire_created_at: number | null;
      }
    >(
      `SELECT o.*, g.id, g.source, g.white, g.black, g.event, g.site, g.result, g.date,
        g.headers_json, g.created_at, r.name AS repertoire_name,
        r.created_at AS repertoire_created_at
        FROM repertoire_game_outcomes o JOIN games g ON g.id = o.game_id
        LEFT JOIN repertoires r ON r.id = o.repertoire_id
        WHERE g.source IN (${placeholders(INSIGHTS_SOURCES)})
        ${repertoireId === null ? "" : "AND o.repertoire_id = ?"}`,
      ...INSIGHTS_SOURCES,
      ...(repertoireId === null ? [] : [repertoireId])
    );
    return rows.map((row) => ({
      ...toRecord(row),
      game: {
        id: row.id,
        source: row.source,
        white: row.white,
        black: row.black,
        event: row.event,
        site: row.site,
        result: row.result,
        date: row.date,
        headers_json: row.headers_json,
        created_at: row.created_at
      },
      repertoireName: row.repertoire_name,
      repertoireCreatedAt: row.repertoire_created_at
    }));
  },

  /** Whether a slip in this game at this position was already applied to the schedule. */
  hasMiss(gameId: string, repertoireId: string, positionKey: string): boolean {
    return (
      get<{ found: number }>(
        `SELECT 1 AS found FROM repertoire_game_misses
          WHERE game_id = ? AND repertoire_id = ? AND position_key = ?`,
        gameId,
        repertoireId,
        positionKey
      ) !== null
    );
  },

  addMiss(gameId: string, repertoireId: string, positionKey: string, at: number): void {
    run(
      `INSERT OR IGNORE INTO repertoire_game_misses (game_id, repertoire_id, position_key, applied_at)
        VALUES (?, ?, ?, ?)`,
      gameId,
      repertoireId,
      positionKey,
      at
    );
  },

  /** A decision's state for a game miss: paused, when its accepted set was first stored, and its fingerprint. */
  decisionForMiss(
    repertoireId: string,
    positionKey: string
  ): { paused: boolean; acceptedAt: number | null; fingerprint: string } | null {
    const row = get<{ paused: number; accepted_at: number | null; acceptance_fingerprint: string }>(
      `SELECT paused, accepted_at, acceptance_fingerprint FROM repertoire_decisions
        WHERE repertoire_id = ? AND position_key = ?`,
      repertoireId,
      positionKey
    );
    return row
      ? {
          paused: row.paused === 1,
          acceptedAt: row.accepted_at,
          fingerprint: row.acceptance_fingerprint
        }
      : null;
  }
};
