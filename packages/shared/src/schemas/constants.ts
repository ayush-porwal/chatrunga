/**
 * The schemas' plain values, without zod: what the renderer needs at startup (the Maia ladder,
 * the coach payload's version) without loading every schema with them.
 */

/** Fixed five-rating ladder used everywhere. Order matters: indexes are aligned. */
export const MAIA_BUCKETS = [1100, 1300, 1500, 1700, 1900] as const;

/** One rung of the Maia ladder. */
export type MaiaRatingBucket = (typeof MAIA_BUCKETS)[number];

/**
 * The coach payload's version. 2: `annotation` (nullable) and its evidence replaced the one-label
 * `classification` every move used to get. Saved commentary records the version it was written
 * from (ReviewCommentary.payloadVersion).
 */
export const REVIEW_INSIGHT_PAYLOAD_VERSION = 2 as const;
