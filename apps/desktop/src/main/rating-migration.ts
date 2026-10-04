/**
 * One-time settings migration: older builds stored one rating (`reviewPlayerRating`); there is now
 * one per Lichess mode (`playerRatings`). The old rating becomes every mode's typed-in rating. An
 * install that never stored one keeps the defaults, and once `playerRatings` is stored this never
 * runs again.
 */
import {
  isPlayerRatings,
  uniformRatings,
  type PlayerRatings
} from "@chaturanga/shared/types/ratings";

export function migratePlayerRatings(deps: {
  /** The stored `playerRatings`, undefined when none is stored. */
  storedRatings: () => unknown;
  /** The stored `reviewPlayerRating` of an older build, undefined when none is stored. */
  legacyRating: () => unknown;
  set: (ratings: PlayerRatings) => void;
}): "migrated" | "unchanged" {
  const stored = deps.storedRatings();
  if (stored !== undefined && isPlayerRatings(stored)) return "unchanged";
  const legacy = deps.legacyRating();
  const rating = typeof legacy === "string" ? Number(legacy) : legacy;
  if (typeof rating !== "number" || !Number.isFinite(rating)) return "unchanged";
  deps.set(uniformRatings(rating));
  return "migrated";
}
