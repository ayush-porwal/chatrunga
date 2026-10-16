/**
 * Lichess broadcast JSON and PGN → the shapes the renderer sees (shared/types/broadcast).
 * Everything from the network is untrusted: unknown fields are dropped, missing ones get safe
 * defaults, and an entry without what identifies it (an id, a name) is left out.
 */
import { makeFen } from "chessops/fen";
import { parseComment, startingPosition, type Game, type PgnNodeData } from "chessops/pgn";
import { makeSan, parseSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { formatSecondsAsClk } from "@chaturanga/shared/chess/pgn";
import { START_FEN, positionFromFen } from "@chaturanga/shared/chess/position";
import type {
  BroadcastGame,
  BroadcastListing,
  BroadcastLiveGame,
  BroadcastMove,
  BroadcastPlayer,
  BroadcastResult,
  BroadcastRound,
  BroadcastRoundDetail,
  BroadcastStanding,
  BroadcastTopPage,
  BroadcastTour,
  BroadcastTourDetail
} from "@chaturanga/shared/types/broadcast";
import { isOneOf, isRecord } from "@chaturanga/shared/types/guards";

type Json = Record<string, unknown>;

/** Lichess ids: tournaments, rounds and games (study chapters) are 8 alphanumeric characters. */
export const BROADCAST_ID = /^[A-Za-z0-9]{8}$/;
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
/** Tournament images are only shown from Lichess's own image host (the renderer's CSP allows it). */
const BROADCAST_IMAGE_ORIGIN = "https://image.lichess1.org";
const LICHESS_URL = /^https:\/\/lichess\.org\//;

function asJson(value: unknown): Json {
  return isRecord(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function int(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function id(value: unknown): string | null {
  return typeof value === "string" && BROADCAST_ID.test(value) ? value : null;
}

function lichessUrl(value: unknown): string | null {
  const url = text(value);
  return url && LICHESS_URL.test(url) ? url : null;
}

function imageUrl(value: unknown): string | null {
  const url = text(value);
  return url?.startsWith(`${BROADCAST_IMAGE_ORIGIN}/`) ? url : null;
}

/** Keeps the entries `normalize` accepts; a malformed one is skipped rather than failing the list. */
function each<T>(values: unknown, normalize: (value: unknown) => T | null): T[] {
  const out: T[] = [];
  for (const value of asArray(values)) {
    try {
      const item = normalize(value);
      if (item !== null) out.push(item);
    } catch {
      // Skipped: one odd entry shouldn't hide the others.
    }
  }
  return out;
}

function normalizeTour(value: unknown): BroadcastTour {
  const json = asJson(value);
  const tourId = id(json.id);
  const name = text(json.name);
  if (!tourId || !name) throw new Error("Lichess returned a broadcast without an id or name.");
  const slug = text(json.slug) ?? "-";
  const info = asJson(json.info);
  const dates = asArray(json.dates).map(int);
  const start = dates[0] ?? null;
  const fideTc = info.fideTC ?? info.fideTc;
  return {
    id: tourId,
    name,
    slug,
    image: imageUrl(json.image),
    description: text(json.description),
    tier: int(json.tier),
    dates: start === null ? null : { start, end: dates[1] ?? null },
    info: {
      format: text(info.format),
      timeControl: text(info.tc),
      fideTimeControl: isOneOf(["standard", "rapid", "blitz"] as const, fideTc) ? fideTc : null,
      location: text(info.location),
      players: text(info.players),
      website: text(info.website),
      standings: text(info.standings),
      timeZone: text(info.timeZone)
    },
    url: lichessUrl(json.url) ?? `https://lichess.org/broadcast/${slug}/${tourId}`
  };
}

function normalizeRound(value: unknown): BroadcastRound {
  const json = asJson(value);
  const roundId = id(json.id);
  const name = text(json.name);
  if (!roundId || !name) throw new Error("Lichess returned a round without an id or name.");
  return {
    id: roundId,
    name,
    slug: text(json.slug) ?? "-",
    url: lichessUrl(json.url) ?? `https://lichess.org/broadcast/-/-/${roundId}`,
    startsAt: int(json.startsAt),
    ongoing: json.ongoing === true,
    finished: json.finished === true || int(json.finishedAt) !== null
  };
}

/** An entry of the top list or a search: `{tour, round?, group?}`. */
function normalizeListing(value: unknown): BroadcastListing {
  const json = asJson(value);
  const group = isRecord(json.group) ? text(json.group.name) : text(json.group);
  return {
    tour: normalizeTour(json.tour),
    round: isRecord(json.round) ? normalizeRound(json.round) : null,
    group
  };
}

/** `GET /api/broadcast/top`. */
export function normalizeTopPage(value: unknown): BroadcastTopPage {
  const json = asJson(value);
  const past = asJson(json.past);
  return {
    active: each(json.active, normalizeListing),
    past: each(past.currentPageResults, normalizeListing),
    nextPastPage: int(past.nextPage)
  };
}

/** `GET /api/broadcast/search`: the page's results. */
export function normalizeSearch(value: unknown): BroadcastListing[] {
  return each(asJson(value).currentPageResults, normalizeListing);
}

/** `GET /api/broadcast/{tourId}`. */
export function normalizeTourDetail(value: unknown): BroadcastTourDetail {
  const json = asJson(value);
  const rounds = each(json.rounds, normalizeRound);
  const defaultRoundId = id(json.defaultRoundId);
  return {
    tour: normalizeTour(json.tour),
    rounds,
    defaultRoundId: rounds.some((round) => round.id === defaultRoundId) ? defaultRoundId : null
  };
}

function normalizePlayer(value: unknown): BroadcastPlayer {
  const json = asJson(value);
  return {
    name: text(json.name) ?? "Unknown player",
    title: text(json.title),
    rating: int(json.rating),
    federation: text(json.fed),
    fideId: int(json.fideId)
  };
}

function normalizeResult(value: unknown): BroadcastResult {
  if (value === "1-0" || value === "0-1") return value;
  if (value === "½-½" || value === "1/2-1/2") return "½-½";
  return "*";
}

/** A FEN that parses, or the standard start. */
function safeFen(value: unknown): string {
  const fen = text(value);
  if (!fen) return START_FEN;
  try {
    positionFromFen(fen);
    return fen;
  } catch {
    return START_FEN;
  }
}

function normalizeRoundGame(value: unknown): BroadcastGame | null {
  const json = asJson(value);
  const gameId = id(json.id);
  if (!gameId) return null;
  const players = asArray(json.players);
  const white = asJson(players[0]);
  const black = asJson(players[1]);
  // Clocks are in centiseconds.
  const clockMs = (player: Json) => {
    const clock = num(player.clock);
    return clock === null ? null : Math.max(0, Math.round(clock * 10));
  };
  const lastMove = text(json.lastMove);
  const result = normalizeResult(json.status);
  const think = num(json.thinkTime);
  return {
    id: gameId,
    name: text(json.name) ?? "",
    white: normalizePlayer(white),
    black: normalizePlayer(black),
    whiteClockMs: clockMs(white),
    blackClockMs: clockMs(black),
    fen: safeFen(json.fen),
    lastMove: lastMove && UCI.test(lastMove) ? lastMove : null,
    thinkTimeSec: result === "*" && think !== null ? Math.max(0, think) : null,
    result
  };
}

/** `GET /api/broadcast/-/-/{roundId}`. */
export function normalizeRoundDetail(value: unknown): BroadcastRoundDetail {
  const json = asJson(value);
  return {
    tour: normalizeTour(json.tour),
    round: normalizeRound(json.round),
    games: each(json.games, normalizeRoundGame)
  };
}

function normalizeStanding(value: unknown): BroadcastStanding | null {
  const json = asJson(value);
  if (!text(json.name)) return null;
  const diffs = asJson(json.ratingDiffs);
  const diff =
    Object.values(diffs)
      .map(num)
      .find((item) => item !== null) ?? num(json.ratingDiff);
  const performances = asJson(json.performances);
  const performance =
    int(json.performance) ??
    Object.values(performances)
      .map(int)
      .find((item) => item !== null) ??
    null;
  return {
    ...normalizePlayer(json),
    rank: int(json.rank),
    score: num(json.score),
    played: int(json.played),
    performance,
    ratingDiff: diff ?? null
  };
}

/** `GET /broadcast/{tourId}/players`. */
export function normalizeStandings(value: unknown): BroadcastStanding[] {
  return each(value, normalizeStanding);
}

/** The game id at the end of a broadcast game's URL (`…/{roundId}/{gameId}`). */
export function gameIdFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const last = url
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .split("/")
    .pop();
  return id(last);
}

function headerPlayer(headers: Map<string, string>, side: "White" | "Black"): BroadcastPlayer {
  const tag = (name: string) => text(headers.get(`${side}${name}`));
  const rating = Number(tag("Elo"));
  const fideId = Number(tag("FideId"));
  return {
    name: text(headers.get(side)) ?? "Unknown player",
    title: tag("Title"),
    rating: Number.isInteger(rating) && rating > 0 ? rating : null,
    federation: tag("Fed") ?? tag("Federation"),
    fideId: Number.isInteger(fideId) && fideId > 0 ? fideId : null
  };
}

/**
 * One game of the round's live PGN stream. Null for a game without its id (`GameURL`) or with
 * an unplayable start; moves stop at the first one that can't be played (a source's typo).
 */
export function liveGameFromPgn(
  game: Game<PgnNodeData>,
  roundId: string
): BroadcastLiveGame | null {
  const headers = game.headers;
  const gameId = gameIdFromUrl(headers.get("GameURL")) ?? gameIdFromUrl(headers.get("Site"));
  if (!gameId) return null;
  const start = startingPosition(headers);
  if (start.isErr) return null;
  const position = start.value;
  const initialFen = makeFen(position.toSetup());
  const moves: BroadcastMove[] = [];
  for (const node of game.moves.mainline()) {
    const move = parseSan(position, node.san);
    if (!move) break;
    const san = makeSan(position, move);
    position.play(move);
    const clock = (node.comments ?? [])
      .map((comment) => parseComment(comment).clock)
      .find((value) => value !== undefined);
    moves.push({
      uci: makeUci(move),
      san,
      clock: clock === undefined ? null : formatSecondsAsClk(clock)
    });
  }
  const header = (name: string) => text(headers.get(name));
  return {
    id: gameId,
    roundId,
    white: headerPlayer(headers, "White"),
    black: headerPlayer(headers, "Black"),
    initialFen,
    moves,
    fen: makeFen(position.toSetup()),
    lastMove: moves.at(-1)?.uci ?? null,
    result: normalizeResult(headers.get("Result")),
    headers: {
      event: header("Event"),
      round: header("Round"),
      date: header("Date") ?? header("UTCDate"),
      timeControl: header("TimeControl"),
      site: lichessUrl(headers.get("GameURL")) ?? lichessUrl(headers.get("Site"))
    }
  };
}
