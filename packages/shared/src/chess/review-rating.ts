/**
 * The rating a game review is made for: it picks the Maia level whose predictions the review reads
 * (difficulty, how likely the best move was to be found). Pure, and never asks Lichess: the review
 * uses what the game and Settings already hold.
 *
 * 1. The game's own rating for the reviewed side: PGN WhiteElo / BlackElo (a Lichess game's headers
 *    carry the players' ratings at the time).
 * 2. Otherwise the Settings rating for the game's mode: Lichess's speed for the TimeControl tag (an
 *    engine game's tag is written from its clock settings), or the speed of a Lichess game. A game
 *    without a time control counts as rapid.
 */
import type { GameHeaders, GameSource } from "../types/chess";
import type { LichessSpeed } from "../types/lichess";
import { isOneOf } from "../types/guards";
import type { PlayerRatings, RatingMode } from "../types/ratings";

/** The Maia models (maia-1): 1100 to 1900 in steps of 100. */
export const MAIA_MODEL_RANGE = { min: 1100, max: 1900, step: 100 } as const;

export type ReviewRatingSource = "game" | "settings";

export type ReviewRating = {
  /** The rating itself: the game's, or the Settings one for `mode`. */
  rating: number;
  source: ReviewRatingSource;
  /** The game's mode (also when the rating came from the game). */
  mode: RatingMode;
  /** The Maia model nearest `rating`; null when no Maia model is installed. */
  maiaModel: number | null;
};

export type ReviewRatingInput = {
  /** The side being reviewed. */
  side: "white" | "black";
  /** The game's own ratings: PGN WhiteElo / BlackElo, or the Lichess game's players. */
  gameRatings?: { white?: number | string | null; black?: number | string | null } | null;
  /** The PGN TimeControl tag (`600+5`, `-`, `1/259200`, …). */
  timeControl?: string | null;
  /** The speed Lichess gave the game, when known from Lichess game data; wins over `timeControl`. */
  speed?: LichessSpeed | null;
  ratings: PlayerRatings;
  /**
   * The installed Maia models; the nearest one is picked. Omitted: any of the full range (rounded
   * to the nearest 100, 1100–1900).
   */
  installedMaiaModels?: readonly number[];
};

const LICHESS_SPEEDS: readonly LichessSpeed[] = [
  "ultraBullet",
  "bullet",
  "blitz",
  "rapid",
  "classical",
  "correspondence"
];

/** A day: a period this long per move is correspondence (`1/86400` and up). */
const DAY_SECONDS = 86_400;

/**
 * Lichess's speed for a clock (lila `Speed`): the estimated game length, base + 40 × increment
 * seconds, against its boundaries. Six hours and longer is correspondence.
 */
export function lichessSpeedForClock(baseSeconds: number, incrementSeconds: number): LichessSpeed {
  const estimate = baseSeconds + 40 * incrementSeconds;
  if (estimate < 30) return "ultraBullet";
  if (estimate < 180) return "bullet";
  if (estimate < 480) return "blitz";
  if (estimate < 1500) return "rapid";
  if (estimate < 21_600) return "classical";
  return "correspondence";
}

/** The rated mode for a Lichess speed (UltraBullet is rated with bullet here). */
export function ratingModeForSpeed(speed: LichessSpeed): RatingMode {
  return speed === "ultraBullet" ? "bullet" : speed;
}

/**
 * The mode a PGN TimeControl tag is played at, or null when it has none (`-`, `?`, missing) or
 * can't be read. Reads `base+increment` and `base` (seconds), sandclock `*seconds` and the first
 * period of `moves/seconds` (a day or more per move is correspondence).
 */
export function ratingModeForTimeControl(
  timeControl: string | null | undefined
): RatingMode | null {
  const tag = timeControl?.trim();
  if (!tag || tag === "-" || tag === "?") return null;
  const period = tag.split(":")[0] ?? "";
  const clock = /^(\d+)(?:\+(\d+(?:\.\d+)?))?$/.exec(period);
  if (clock)
    return ratingModeForSpeed(lichessSpeedForClock(Number(clock[1]), Number(clock[2] ?? 0)));
  const sandclock = /^\*(\d+)$/.exec(period);
  if (sandclock) return ratingModeForSpeed(lichessSpeedForClock(Number(sandclock[1]), 0));
  const moves = /^(\d+)\/(\d+)$/.exec(period);
  if (moves && Number(moves[1]) > 0) {
    const seconds = Number(moves[2]);
    if (seconds / Number(moves[1]) >= DAY_SECONDS) return "correspondence";
    return ratingModeForSpeed(lichessSpeedForClock(seconds, 0));
  }
  return null;
}

/** A PGN Elo tag (`"1533"`) or a number as a rating; null for `?`, `-`, blanks and nonsense. */
export function parseGameRating(value: number | string | null | undefined): number | null {
  const rating =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\s*\d{1,4}\s*$/.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isInteger(rating) && rating > 0 && rating <= 4000 ? rating : null;
}

/**
 * The Maia model for a rating: the nearest installed one (the lower on a tie, as the review's
 * level pick does), or — with no list — the rating rounded to the nearest 100 within 1100–1900.
 */
export function nearestMaiaModel(rating: number, installed?: readonly number[]): number | null {
  if (installed) {
    let nearest: number | null = null;
    for (const model of installed) {
      if (
        nearest === null ||
        Math.abs(model - rating) < Math.abs(nearest - rating) ||
        (Math.abs(model - rating) === Math.abs(nearest - rating) && model < nearest)
      )
        nearest = model;
    }
    return nearest;
  }
  const { min, max, step } = MAIA_MODEL_RANGE;
  return Math.max(min, Math.min(max, Math.round(rating / step) * step));
}

/** The rating a review uses, and where it came from (see the file comment). */
export function resolveReviewRating(input: ReviewRatingInput): ReviewRating {
  const mode = input.speed
    ? ratingModeForSpeed(input.speed)
    : (ratingModeForTimeControl(input.timeControl) ?? "rapid");
  const own = parseGameRating(input.gameRatings?.[input.side]);
  const rating = own ?? input.ratings[mode].rating;
  return {
    rating,
    source: own === null ? "settings" : "game",
    mode,
    maiaModel: nearestMaiaModel(rating, input.installedMaiaModels)
  };
}

/**
 * The speed a Lichess game was played at, from its Event tag (`Rated Blitz game`, `Casual
 * Correspondence game`): Lichess game data, for games imported from or played on Lichess.
 */
export function lichessSpeedFromHeaders(
  headers: Pick<GameHeaders, "event" | "site">,
  source?: GameSource | null
): LichessSpeed | null {
  const fromLichess = source === "lichess" || /^https?:\/\/lichess\.org\//.test(headers.site ?? "");
  if (!fromLichess) return null;
  const word = /\b(ultrabullet|bullet|blitz|rapid|classical|correspondence)\b/i
    .exec(headers.event ?? "")?.[1]
    ?.toLowerCase();
  const speed = word === "ultrabullet" ? "ultraBullet" : word;
  return isOneOf(LICHESS_SPEEDS, speed) ? speed : null;
}

/** What a review needs to know about a game to resolve its rating (sent to main with a review). */
export type ReviewRatingContext = {
  side: "white" | "black";
  whiteElo: number | null;
  blackElo: number | null;
  speed: LichessSpeed | null;
};

/** The rating context of a game, from its headers and source. */
export function reviewRatingContext(
  headers: Pick<GameHeaders, "whiteElo" | "blackElo" | "event" | "site">,
  source: GameSource | null | undefined,
  side: "white" | "black"
): ReviewRatingContext {
  return {
    side,
    whiteElo: parseGameRating(headers.whiteElo),
    blackElo: parseGameRating(headers.blackElo),
    speed: lichessSpeedFromHeaders(headers, source)
  };
}

/** {@link resolveReviewRating} for a game's headers and source. */
export function resolveGameReviewRating(input: {
  headers: Pick<GameHeaders, "whiteElo" | "blackElo" | "event" | "site" | "timeControl">;
  source?: GameSource | null;
  side: "white" | "black";
  ratings: PlayerRatings;
  installedMaiaModels?: readonly number[];
}): ReviewRating {
  const context = reviewRatingContext(input.headers, input.source, input.side);
  return resolveReviewRating({
    side: context.side,
    gameRatings: { white: context.whiteElo, black: context.blackElo },
    timeControl: input.headers.timeControl,
    speed: context.speed,
    ratings: input.ratings,
    installedMaiaModels: input.installedMaiaModels
  });
}
