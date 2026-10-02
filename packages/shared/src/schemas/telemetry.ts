import { z } from "zod";
import {
  COMMENTARY_VIEW_SOURCES,
  TELEMETRY_ACTIVITY_KINDS,
  type CommentaryRequestContext,
  type TelemetryRendererEvent
} from "../types/telemetry";

/** Review operation ids are UUIDs (crypto.randomUUID in the renderer). */
const reviewId = z.string().uuid().nullable();
/** Library game ids (UUIDs or older nanoid-style ids); main only ever uses them hashed. */
const gameId = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/)
  .nullable();

/**
 * The only shapes the renderer may report for usage analytics. Strict objects: an extra field (a
 * FEN, a name, a free-text property) rejects the whole event instead of being passed along.
 */
const rendererEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("activity"), kind: z.enum(TELEMETRY_ACTIVITY_KINDS) }).strict(),
  z.object({ type: z.literal("review_opened"), reviewId, gameId }).strict(),
  z.object({ type: z.literal("review_studied"), reviewId, gameId }).strict(),
  z
    .object({
      type: z.literal("commentary_viewed"),
      reviewId,
      gameId,
      ply: z.number().int().min(0).max(2_000),
      source: z.enum(COMMENTARY_VIEW_SOURCES)
    })
    .strict()
]);

export function parseTelemetryRendererEvent(value: unknown): TelemetryRendererEvent {
  return rendererEventSchema.parse(value);
}

const commentaryContextSchema = z
  .object({ reviewId, gameId, trigger: z.enum(["auto", "user_retry"]) })
  .strict();

/** The optional correlation sent with a commentary request; anything malformed is dropped. */
export function parseCommentaryRequestContext(value: unknown): CommentaryRequestContext | null {
  const parsed = commentaryContextSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
