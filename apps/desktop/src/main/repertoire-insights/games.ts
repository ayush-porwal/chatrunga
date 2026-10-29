/**
 * The user's games as Insights reads them (docs/repertoire-games-and-practice.md §5): which ones
 * count (Lichess, Chess.com and imported games), when each was played, its account, time control,
 * rated flag and result, and whether it passes the saved filters. Pure apart from the clock.
 */
import { gameRatingMode, parseGameRating } from "@chaturanga/shared/chess/review-rating";
import type { Color, GameHeaders, GameSource } from "@chaturanga/shared/types/chess";
import type { RatingMode } from "@chaturanga/shared/types/ratings";
import type {
  InsightsAccount,
  InsightsFilters
} from "@chaturanga/shared/types/repertoire-insights";
import { storedHeaders } from "../db/stored-game";

/** Where each account's games come from, as the games table names it. */
const ACCOUNT_SOURCES: Record<InsightsAccount, GameSource> = {
  lichess: "lichess",
  chesscom: "chesscom",
  imported: "pgn-import"
};
export const INSIGHTS_SOURCES: readonly GameSource[] = Object.values(ACCOUNT_SOURCES);

function accountOf(source: string): InsightsAccount | null {
  if (source === "lichess" || source === "chesscom") return source;
  return source === "pgn-import" ? "imported" : null;
}

/** The games-table columns Insights reads about a game (no moves). */
export type GameInfoRow = {
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
};

/** A game's facts the filters and the games list read. */
export type GameInfo = {
  id: string;
  account: InsightsAccount;
  white: string | null;
  black: string | null;
  headers: GameHeaders;
  playedAt: number | null;
  timeControl: RatingMode;
  rated: boolean;
};

const PGN_DATE = /^(\d{4})\.(\d{2})\.(\d{2})$/;
const PGN_TIME = /^(\d{2}):(\d{2}):(\d{2})$/;

/**
 * When a game was played (epoch ms): its UTCDate and UTCTime, else its Date (midnight UTC); a
 * synced game without either was stored at its play time. Null when nothing says.
 */
function playedAtOf(headers: GameHeaders, source: string, storedAt: number): number | null {
  const at = headerTime(headers.utcDate, headers.utcTime) ?? headerTime(headers.date, null);
  if (at !== null) return at;
  return source === "lichess" || source === "chesscom" ? storedAt : null;
}

/** A PGN date (and time, UTC) as epoch ms; null when the date isn't a whole one. */
function headerTime(date: string | null | undefined, time: string | null | undefined) {
  const day = PGN_DATE.exec(date?.trim() ?? "");
  if (!day) return null;
  const clock = PGN_TIME.exec(time?.trim() ?? "") ?? ["", "0", "0", "0"];
  const at = Date.UTC(
    Number(day[1]),
    Number(day[2]) - 1,
    Number(day[3]),
    Number(clock[1]),
    Number(clock[2]),
    Number(clock[3])
  );
  return Number.isFinite(at) ? at : null;
}

/** A game row read as Insights uses it; null for a game that isn't one of the user's. */
export function gameInfoOf(row: GameInfoRow): GameInfo | null {
  const account = accountOf(row.source);
  if (!account) return null;
  const headers: GameHeaders = {
    event: row.event,
    site: row.site,
    date: row.date,
    white: row.white,
    black: row.black,
    result: row.result,
    ...storedHeaders(row.headers_json)
  };
  return {
    id: row.id,
    account,
    white: row.white,
    black: row.black,
    headers,
    playedAt: playedAtOf(headers, row.source, row.created_at),
    timeControl: gameRatingMode(headers, ACCOUNT_SOURCES[account]),
    // Lichess writes "Casual Blitz game"; Chess.com and PGN files don't say, and count as rated.
    rated: !/\bcasual\b/i.test(headers.event ?? "")
  };
}

/** The user's result in a game, from its Result header. */
export function userResult(headers: GameHeaders, color: Color): "win" | "draw" | "loss" | null {
  const result = headers.result?.trim();
  if (result === "1/2-1/2") return "draw";
  if (result === "1-0") return color === "white" ? "win" : "loss";
  if (result === "0-1") return color === "black" ? "win" : "loss";
  return null;
}

export function opponentRatingOf(headers: GameHeaders, color: Color): number | null {
  return parseGameRating(color === "white" ? headers.blackElo : headers.whiteElo);
}

const MONTHS: Partial<Record<InsightsFilters["period"], number>> = {
  "3m": 3,
  "6m": 6,
  "1y": 12,
  "2y": 24
};

/** The first instant the period counts (epoch ms), or null for all time. */
export function periodStart(filters: Pick<InsightsFilters, "period" | "since">, now: number) {
  if (filters.period === "since") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(filters.since ?? "");
    return match
      ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime()
      : null;
  }
  const months = MONTHS[filters.period];
  if (months === undefined) return null;
  const start = new Date(now);
  start.setMonth(start.getMonth() - months);
  return start.getTime();
}

/** Which of the filters a game passes; `ignore` leaves one out (the menus count under the rest). */
export function passesFilters(
  game: GameInfo,
  filters: InsightsFilters,
  now: number,
  ignore: "timeControls" | "accounts" | null = null
): boolean {
  const start = periodStart(filters, now);
  if (start !== null && (game.playedAt === null || game.playedAt < start)) return false;
  if (filters.ratedOnly && !game.rated) return false;
  if (ignore !== "timeControls" && !filters.timeControls.includes(game.timeControl)) return false;
  return ignore === "accounts" || filters.accounts.includes(game.account);
}
