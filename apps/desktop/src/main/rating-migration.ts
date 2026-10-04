/**
 * Settings migration for the per-mode ratings:
 * - older builds stored one rating (`reviewPlayerRating`); there is now one per Lichess mode
 *   (`playerRatings`). The old rating becomes every mode's typed-in rating. An install that never
 *   stored one keeps the defaults, and once `playerRatings` is stored this never runs again;
 * - ratings stored with the `edited` / `provisional` flags of an earlier build are stored again
 *   without them (same values and sources).
 */
import {
  isPlayerRatings,
  normalizePlayerRatings,
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
  if (stored !== undefined && isPlayerRatings(stored)) {
    const current = normalizePlayerRatings(stored);
    if (JSON.stringify(current) === JSON.stringify(stored)) return "unchanged";
    deps.set(current);
    return "migrated";
  }
  const legacy = deps.legacyRating();
  const rating = typeof legacy === "string" ? Number(legacy) : legacy;
  if (typeof rating !== "number" || !Number.isFinite(rating)) return "unchanged";
  deps.set(uniformRatings(rating));
  return "migrated";
}
