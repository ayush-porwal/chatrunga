/**
 * Barrel export for the shared zod schemas: the commentary payload built in the
 * renderer and validated in the desktop main process, and the review facts it carries.
 */

export type { TacticalFact } from "./tactical-fact";
export type { EngineSignal } from "./engine-signal";
export { MAIA_BUCKETS, type MaiaRatingBucket, type RatingCurve } from "./rating-curve";
export {
  reviewInsightPayloadSchema,
  type CuratorReason,
  type EvalAssessment,
  type ReviewInsightPayload
} from "./review-insight";
