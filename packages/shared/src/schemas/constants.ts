/**
 * The schemas' plain values, without zod: what the renderer needs at startup (the Maia ladder,
 * the coach payload's version) without loading every schema with them.
 */

/** Maia 1's five rating levels (reviews before Maia 3), ascending. */
export const MAIA_BUCKETS = [1100, 1300, 1500, 1700, 1900] as const;

/**
 * The coach payload's version. 2: `annotation` (nullable) and its evidence replaced the one-label
 * `classification` every move used to get. 3: Maia 3 — `engines.maia` reads the move at one rating
 * (Maia 3's mover's rating, or Maia 1's level nearest the player's), the rating curve has the
 * ratings it was read at (Maia 3's 21, Maia 1's five) and is only sent when the move has one.
 * Saved commentary records the version it was written from (ReviewCommentary.payloadVersion).
 */
export const REVIEW_INSIGHT_PAYLOAD_VERSION = 3 as const;

/** The first payload version with move marks: commentary written from an older one predates them. */
export const MARKED_PAYLOAD_VERSION = 2;
