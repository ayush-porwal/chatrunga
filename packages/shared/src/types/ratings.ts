/**
 * The player's rating per Lichess mode (Settings → Ratings). Game review reads the one for the
 * reviewed game's mode when the game has no rating of its own (see chess/review-rating.ts).
 *
 * A rating is typed in (manual) or synced from the connected Lichess account. With Lichess
 * connected every mode comes from the account and can't be edited; disconnecting keeps the last
 * synced values as typed-in ones.
 */
import { isOneOf, isRecord } from "./guards";
import type { LichessPerf, LichessSpeed } from "./lichess";

/** The rated modes, named as Lichess's perf keys (`/api/account` → `perfs`). */
export const RATING_MODES = [
  "bullet",
  "blitz",
  "rapid",
  "classical",
  "correspondence"
] as const satisfies readonly LichessSpeed[];
export type RatingMode = (typeof RATING_MODES)[number];

export const RATING_MODE_LABELS: Record<RatingMode, string> = {
  bullet: "Bullet",
  blitz: "Blitz",
  rapid: "Rapid",
  classical: "Classical",
  correspondence: "Correspondence"
};

/** Ratings a mode may hold: Lichess's floor is 400, older systems go lower; nobody is above 3500. */
export const RATING_RANGE = { min: 100, max: 3500 } as const;
export const DEFAULT_PLAYER_RATING = 1500;

export type ManualModeRating = { source: "manual"; rating: number };

export type LichessModeRating = {
  source: "lichess";
  rating: number;
  /** When it was read from Lichess (epoch ms). */
  syncedAt: number;
};

export type ModeRating = ManualModeRating | LichessModeRating;
export type PlayerRatings = Record<RatingMode, ModeRating>;

export function clampRating(value: number): number {
  return Math.max(RATING_RANGE.min, Math.min(RATING_RANGE.max, Math.round(value)));
}

/** Every mode at `rating`, typed in. */
export function uniformRatings(rating: number = DEFAULT_PLAYER_RATING): PlayerRatings {
  const value = clampRating(rating);
  return {
    bullet: { source: "manual", rating: value },
    blitz: { source: "manual", rating: value },
    rapid: { source: "manual", rating: value },
    classical: { source: "manual", rating: value },
    correspondence: { source: "manual", rating: value }
  };
}

function isRating(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= RATING_RANGE.min &&
    value <= RATING_RANGE.max
  );
}

/**
 * Whether a value is a well-formed mode rating (what may be stored). Earlier builds of this branch
 * also stored `edited` and `provisional` flags; they are ignored (`normalizePlayerRatings` drops
 * them).
 */
export function isModeRating(value: unknown): value is ModeRating {
  if (!isRecord(value) || !isRating(value.rating)) return false;
  if (value.source === "manual") return true;
  return (
    value.source === "lichess" &&
    typeof value.syncedAt === "number" &&
    Number.isFinite(value.syncedAt) &&
    value.syncedAt >= 0
  );
}

/** A well-formed mode rating with only the fields it has today. */
function canonicalModeRating(rating: ModeRating): ModeRating {
  return rating.source === "manual"
    ? { source: "manual", rating: rating.rating }
    : { source: "lichess", rating: rating.rating, syncedAt: rating.syncedAt };
}

/** Whether a value is a rating for each of the five modes and nothing else. */
export function isPlayerRatings(value: unknown): value is PlayerRatings {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === RATING_MODES.length &&
    keys.every((key) => isOneOf(RATING_MODES, key)) &&
    RATING_MODES.every((mode) => isModeRating(value[mode]))
  );
}

/**
 * Stored ratings as they can be used: each mode's well-formed value (without fields older builds
 * stored), the default for a mode that is missing or damaged. Idempotent.
 */
export function normalizePlayerRatings(value: unknown): PlayerRatings {
  const fallback = uniformRatings();
  const ratings = { ...fallback };
  if (!isRecord(value)) return ratings;
  for (const mode of RATING_MODES) {
    const item = value[mode];
    if (isModeRating(item)) ratings[mode] = canonicalModeRating(item);
  }
  return ratings;
}

/** A rating synced from the connected Lichess account: read-only in Settings. */
export function isRatingLocked(rating: ModeRating): rating is LichessModeRating {
  return rating.source === "lichess";
}

/** Any mode holds a rating from Lichess. */
export function hasLichessRatings(ratings: PlayerRatings): boolean {
  return RATING_MODES.some((mode) => ratings[mode].source === "lichess");
}

/**
 * The account's ratings applied: each one Lichess has (provisional or not) replaces the mode's; a
 * mode Lichess has no rating for keeps its value.
 */
export function applyLichessPerfs(
  current: PlayerRatings,
  perfs: Partial<Record<LichessSpeed, LichessPerf>>,
  syncedAt: number
): PlayerRatings {
  const next = { ...current };
  for (const mode of RATING_MODES) {
    const perf = perfs[mode];
    if (!perf || !Number.isFinite(perf.rating)) continue;
    next[mode] = { source: "lichess", rating: clampRating(perf.rating), syncedAt };
  }
  return next;
}

/** Lichess disconnected: each synced rating stays, as a typed-in one. */
export function releaseLichessRatings(current: PlayerRatings): PlayerRatings {
  const next = { ...current };
  for (const mode of RATING_MODES) {
    const item = current[mode];
    if (item.source === "lichess") next[mode] = { source: "manual", rating: item.rating };
  }
  return next;
}

/** A rating typed for one mode in Settings; a locked (synced) mode is left as it is. */
export function setManualRating(
  current: PlayerRatings,
  mode: RatingMode,
  rating: number
): PlayerRatings {
  if (isRatingLocked(current[mode])) return current;
  return { ...current, [mode]: { source: "manual", rating: clampRating(rating) } };
}

/** The welcome's one rating, for every mode but the locked (synced) ones. */
export function applyRatingToAllModes(current: PlayerRatings, rating: number): PlayerRatings {
  const next = { ...current };
  for (const mode of RATING_MODES) {
    if (!isRatingLocked(current[mode]))
      next[mode] = { source: "manual", rating: clampRating(rating) };
  }
  return next;
}

/** The rating the welcome shows as "yours" (it sets every mode; rapid is the default mode). */
export function headlineRating(ratings: PlayerRatings): number {
  return ratings.rapid.rating;
}
