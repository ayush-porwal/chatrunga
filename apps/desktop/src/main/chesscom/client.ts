/**
 * Chess.com's Published-Data API (https://api.chess.com/pub/…): read-only, no sign-in. Chess.com
 * refuses parallel requests (429), so the client sends one at a time, and names the app in its
 * User-Agent as chess.com asks. Every answer is checked before use: the parsers below keep only
 * the fields the app reads, and drop what doesn't fit.
 */
import { CHESSCOM_RATING_KEYS, type ChesscomRatings } from "@chaturanga/shared/types/chesscom";
import { isRecord } from "@chaturanga/shared/types/guards";
import { createSerialQueue } from "../secure-json-file";

export const CHESSCOM_API_ORIGIN = "https://api.chess.com";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const CHESSCOM_RATE_LIMITED_ERROR =
  "Chess.com is limiting requests right now. Try again in a minute.";
const UNREACHABLE_ERROR = "Couldn't reach chess.com. Check your internet connection.";

/** A refused request: `status` is the HTTP status (0 when chess.com couldn't be reached). */
export class ChesscomHttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ChesscomHttpError";
  }
}

export function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}

/** One readable sentence for a refused request. */
export function chesscomErrorMessage(status: number): string {
  if (status === 429) return CHESSCOM_RATE_LIMITED_ERROR;
  if (status === 404) return "Chess.com couldn't find that.";
  if (status >= 500) return `Chess.com is having trouble right now (${status}). Try again later.`;
  return `Chess.com refused the request (${status}).`;
}

export type ChesscomClientOptions = {
  fetch?: FetchLike;
  /** Names the app (chess.com asks API clients to say who they are). */
  userAgent: string;
};

/** GET requests to the Published-Data API, one at a time; refused ones throw ChesscomHttpError. */
export class ChesscomClient {
  private readonly fetchImpl: FetchLike;
  /** The request in flight (or the last one): the next waits for it. */
  private readonly serialize = createSerialQueue();

  constructor(private readonly options: ChesscomClientOptions) {
    // Looked up per call, so a fetch replaced later (the e2e harness's) is the one used.
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  /** The JSON answer to `path` (`/pub/…`), unchecked: the parsers below check it. */
  json(path: string, signal?: AbortSignal): Promise<unknown> {
    return this.serialize(() => this.request(path, signal));
  }

  private async request(path: string, signal?: AbortSignal): Promise<unknown> {
    if (!path.startsWith("/pub/")) throw new Error(`Not a chess.com API path: ${path}`);
    signal?.throwIfAborted();
    let response: Response;
    try {
      response = await this.fetchImpl(`${CHESSCOM_API_ORIGIN}${path}`, {
        method: "GET",
        headers: { Accept: "application/json", "User-Agent": this.options.userAgent },
        signal
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new ChesscomHttpError(UNREACHABLE_ERROR, 0);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ChesscomHttpError(chesscomErrorMessage(response.status), response.status);
    }
    try {
      const body: unknown = await response.json();
      return body;
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new ChesscomHttpError(
        "Chess.com sent an answer the app couldn't read.",
        response.status
      );
    }
  }
}

/** The API path of a player's resource (`""`, `/stats`, `/games/archives`, `/games/2024/05`). */
export function playerPath(username: string, rest = ""): string {
  return `/pub/player/${encodeURIComponent(username.toLowerCase())}${rest}`;
}

export type ChesscomProfile = { id: string; username: string; title: string | null };

/**
 * A player's profile (`/pub/player/{username}`). The API's `username` is lowercase; the profile
 * URL (`https://www.chess.com/member/Name`) has it as chess.com shows it. Null when the answer
 * isn't a profile.
 */
export function parseProfile(json: unknown): ChesscomProfile | null {
  if (!isRecord(json) || typeof json.username !== "string") return null;
  const id = json.username.trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,50}$/.test(id)) return null;
  const shown =
    typeof json.url === "string" ? /\/member\/([A-Za-z0-9_-]{1,50})$/.exec(json.url)?.[1] : null;
  return {
    id,
    username: shown && shown.toLowerCase() === id ? shown : id,
    title: typeof json.title === "string" && /^[A-Z]{1,4}$/.test(json.title) ? json.title : null
  };
}

/** The player's current rating per kind of standard chess (`/stats` → `chess_rapid.last.rating`). */
export function parseStats(json: unknown): ChesscomRatings {
  const ratings: ChesscomRatings = {};
  if (!isRecord(json)) return ratings;
  for (const key of CHESSCOM_RATING_KEYS) {
    const record = json[`chess_${key}`];
    const last = isRecord(record) ? record.last : null;
    const rating = isRecord(last) ? last.rating : null;
    if (typeof rating === "number" && Number.isFinite(rating) && rating > 0 && rating < 5000)
      ratings[key] = Math.round(rating);
  }
  return ratings;
}

/** A month of games (`YYYY/MM`, as in the archive paths; sorts in time order). */
export type ArchiveMonth = string;

/** The month a time falls in (UTC), as an archive month. */
export function archiveMonthOf(epochMs: number): ArchiveMonth {
  const date = new Date(epochMs);
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * The months the player has games in (`/games/archives` lists their URLs), oldest first. Only
 * well-formed months are kept; the paths are rebuilt from them, never followed as given.
 */
export function parseArchiveMonths(json: unknown): ArchiveMonth[] {
  if (!isRecord(json) || !Array.isArray(json.archives)) return [];
  const months = new Set<ArchiveMonth>();
  for (const url of json.archives) {
    if (typeof url !== "string") continue;
    const match = /\/games\/(\d{4})\/(\d{2})$/.exec(url);
    if (!match) continue;
    const month = Number(match[2]);
    if (month >= 1 && month <= 12) months.add(`${match[1]}/${match[2]}`);
  }
  return [...months].sort();
}

/** One finished game of a monthly archive, as the importer reads it. */
export type ChesscomGame = {
  /** The game's page (`https://www.chess.com/game/live/…`): its identity in the library. */
  url: string;
  pgn: string | null;
  /** `chess` for standard chess; `chess960`, `bughouse`, … for variants. */
  rules: string;
  /** When it ended (epoch seconds). */
  endTime: number;
};

const GAME_URL = /^https:\/\/www\.chess\.com\/[\w/-]{1,200}$/;

/** A monthly archive's games (`/games/{YYYY}/{MM}`); entries that don't fit are left out. */
export function parseArchiveGames(json: unknown): ChesscomGame[] {
  if (!isRecord(json) || !Array.isArray(json.games)) return [];
  const games: ChesscomGame[] = [];
  for (const item of json.games) {
    if (!isRecord(item)) continue;
    const { url, pgn, rules, end_time: endTime } = item;
    if (typeof url !== "string" || !GAME_URL.test(url)) continue;
    if (typeof endTime !== "number" || !Number.isFinite(endTime) || endTime <= 0) continue;
    games.push({
      url,
      pgn: typeof pgn === "string" && pgn.trim() ? pgn : null,
      // Without rules it can't be told apart from a variant: the importer skips it.
      rules: typeof rules === "string" ? rules : "",
      endTime: Math.floor(endTime)
    });
  }
  return games;
}
