/**
 * Lichess JSON → the shapes the renderer sees (shared/types/lichess). Everything from the network
 * is treated as untrusted: unknown fields are dropped and missing ones get safe defaults.
 */
import { START_FEN } from "@chaturanga/shared/chess/position";
import type {
  LichessAccount,
  LichessChallenge,
  LichessEvent,
  LichessGameFull,
  LichessGameState,
  LichessPerf,
  LichessPlayer,
  LichessSpeed
} from "@chaturanga/shared/types/lichess";

type Json = Record<string, unknown>;

const SPEEDS: readonly LichessSpeed[] = [
  "ultraBullet",
  "bullet",
  "blitz",
  "rapid",
  "classical",
  "correspondence"
];
/** The ratings shown for the account (Lichess also rates variants and puzzles). */
const ACCOUNT_PERFS: readonly LichessSpeed[] = [
  "bullet",
  "blitz",
  "rapid",
  "classical",
  "correspondence"
];

function asJson(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function int(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function color(value: unknown): "white" | "black" | null {
  return value === "white" || value === "black" ? value : null;
}

function speed(value: unknown, fallback: LichessSpeed): LichessSpeed {
  return SPEEDS.includes(value as LichessSpeed) ? (value as LichessSpeed) : fallback;
}

/** `GET /api/account`. `lastSyncAt` is ours, not Lichess's. */
export function normalizeAccount(
  value: unknown,
  connectedAt: number,
  lastSyncAt: number | null = null
): LichessAccount {
  const json = asJson(value);
  const username = text(json.username);
  const id = text(json.id) ?? username?.toLowerCase();
  if (!id || !username) throw new Error("Lichess returned an account without a username.");
  const perfs: LichessAccount["perfs"] = {};
  const sourcePerfs = asJson(json.perfs);
  for (const key of ACCOUNT_PERFS) {
    const perf = asJson(sourcePerfs[key]);
    const rating = int(perf.rating);
    if (rating === null) continue;
    perfs[key] = {
      rating,
      games: int(perf.games) ?? 0,
      provisional: perf.prov === true
    } satisfies LichessPerf;
  }
  return { id, username, title: text(json.title), perfs, connectedAt, lastSyncAt };
}

/** A game player (`GameEventPlayer`) or challenge user; the Lichess AI has only `aiLevel`. */
export function normalizePlayer(value: unknown): LichessPlayer {
  const json = asJson(value);
  const aiLevel = int(json.aiLevel);
  if (aiLevel !== null) {
    return { id: null, name: `Stockfish level ${aiLevel}`, rating: null, title: null, aiLevel };
  }
  const id = text(json.id);
  return {
    id,
    name: text(json.name) ?? text(json.username) ?? id ?? "Anonymous",
    rating: int(json.rating),
    title: text(json.title),
    aiLevel: null
  };
}

export function normalizeGameState(value: unknown): LichessGameState {
  const json = asJson(value);
  const moves = typeof json.moves === "string" ? json.moves.split(" ").filter(Boolean) : [];
  return {
    moves,
    wtime: int(json.wtime) ?? 0,
    btime: int(json.btime) ?? 0,
    winc: int(json.winc) ?? 0,
    binc: int(json.binc) ?? 0,
    status: text(json.status) ?? "started",
    winner: color(json.winner),
    drawOffer: json.wdraw === true ? "white" : json.bdraw === true ? "black" : null
  };
}

export function normalizeGameFull(value: unknown): LichessGameFull {
  const json = asJson(value);
  const id = text(json.id);
  if (!id) throw new Error("Lichess sent a game without an id.");
  const clock = asJson(json.clock);
  const initialMs = int(clock.initial);
  const initialFen = text(json.initialFen);
  return {
    id,
    rated: json.rated === true,
    speed: speed(json.speed, "correspondence"),
    clock: initialMs === null ? null : { initialMs, incrementMs: int(clock.increment) ?? 0 },
    white: normalizePlayer(json.white),
    black: normalizePlayer(json.black),
    initialFen: !initialFen || initialFen === "startpos" ? START_FEN : initialFen,
    state: normalizeGameState(json.state),
    createdAt: int(json.createdAt) ?? Date.now()
  };
}

/** Anything but `created` / `started` means the game is over. */
export function isFinalStatus(status: string): boolean {
  return status !== "created" && status !== "started";
}

/** `ChallengeJson` seen from `myId`'s side. */
export function normalizeChallenge(value: unknown, myId: string): LichessChallenge {
  const json = asJson(value);
  const id = text(json.id);
  if (!id) throw new Error("Lichess sent a challenge without an id.");
  const challenger = asJson(json.challenger);
  const direction: LichessChallenge["direction"] =
    json.direction === "in" || json.direction === "out"
      ? json.direction
      : text(challenger.id) === myId
        ? "out"
        : "in";
  const opponentJson = direction === "out" ? json.destUser : json.challenger;
  const opponent: LichessPlayer = opponentJson
    ? normalizePlayer(opponentJson)
    : { id: null, name: "Open challenge", rating: null, title: null, aiLevel: null };
  const timeControl = asJson(json.timeControl);
  const limit = int(timeControl.limit);
  // `color` is the challenger's pick.
  const challengerColor = color(json.color) ?? "random";
  const yourColor =
    direction === "out" || challengerColor === "random"
      ? challengerColor
      : challengerColor === "white"
        ? "black"
        : "white";
  return {
    id,
    direction,
    opponent,
    rated: json.rated === true,
    speed: speed(json.speed, "correspondence"),
    timeControl:
      timeControl.type === "clock" && limit !== null
        ? { minutes: limit / 60, incrementSec: int(timeControl.increment) ?? 0 }
        : null,
    yourColor
  };
}

/**
 * One line of `GET /api/stream/event` as a renderer event, or null for what the renderer doesn't
 * need (`gameFinish`: the game stream reports the end).
 */
export function eventFromStream(value: unknown, myId: string): LichessEvent | null {
  const json = asJson(value);
  switch (json.type) {
    case "gameStart": {
      const game = asJson(json.game);
      const gameId = text(game.gameId) ?? text(game.id);
      return gameId ? { type: "gameStart", gameId } : null;
    }
    case "challenge":
      return { type: "challenge", challenge: normalizeChallenge(json.challenge, myId) };
    case "challengeCanceled":
    case "challengeDeclined": {
      const challengeId = text(asJson(json.challenge).id);
      if (!challengeId) return null;
      const reason = json.type === "challengeDeclined" ? "declined" : "canceled";
      return { type: "challengeGone", challengeId, reason };
    }
    default:
      return null;
  }
}

/**
 * Lichess estimates a game's length as `limit + 40 × increment` seconds; below 8 minutes it is
 * blitz or faster, which third-party apps may not seek or play through the Board API.
 */
export const RAPID_MIN_ESTIMATE_SECONDS = 480;

export function estimatedGameSeconds(minutes: number, incrementSec: number): number {
  return minutes * 60 + 40 * incrementSec;
}

export function assertRapidOrSlower(minutes: number, incrementSec: number): void {
  if (estimatedGameSeconds(minutes, incrementSec) < RAPID_MIN_ESTIMATE_SECONDS) {
    throw new Error(
      "Lichess only allows Rapid or slower games from apps: the time plus 40 × the increment must reach 8 minutes (e.g. 10+0 or 5+5)."
    );
  }
}
