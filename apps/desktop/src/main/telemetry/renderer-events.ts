import type { TelemetryRendererEvent } from "@chaturanga/shared/types/telemetry";
import type { TelemetryService } from "./service";

export { parseTelemetryRendererEvent as parseRendererEvent } from "@chaturanga/shared/schemas/telemetry";

/**
 * Records a validated renderer interaction. Main adds identity and common metadata, turns game ids
 * into pseudonyms and keeps the once-per-session rules, whatever the renderer sends.
 */
/** Whether the report was taken: an activity that couldn't be counted (a failed write) is false. */
export function recordRendererEvent(
  telemetry: TelemetryService,
  event: TelemetryRendererEvent
): boolean {
  if (!telemetry.enabled) return false;
  if (event.type === "activity") return telemetry.markActive(event.kind);
  const gameRef = telemetry.gameRef(event.gameId);
  const review = {
    review_id: event.reviewId ?? undefined,
    game_ref: gameRef ?? undefined,
    legacy_review: !event.reviewId
  };
  // A review saved before reviews had ids is told apart by its game.
  const reviewKey = event.reviewId ?? `game:${gameRef ?? "unknown"}`;

  switch (event.type) {
    case "review_opened":
      if (!telemetry.firstInSession(`review_opened:${reviewKey}`)) return true;
      telemetry.record("review_opened", review);
      telemetry.markActive("study");
      return true;
    case "review_studied":
      if (!telemetry.firstInSession(`review_studied:${reviewKey}`)) return true;
      telemetry.record("review_studied", review);
      telemetry.milestone("review_studied");
      telemetry.markActive("study");
      return true;
    case "commentary_viewed": {
      if (!telemetry.firstInSession(`commentary_viewed:${reviewKey}:${event.ply}`)) return true;
      telemetry.record("commentary_viewed", {
        ...review,
        ply: event.ply,
        served_from_cache: event.source === "cached"
      });
      // The first explanation viewed for this game in this session opens a commentary session.
      if (telemetry.firstInSession(`commentary_session:${gameRef ?? reviewKey}`)) {
        telemetry.record("commentary_session_started", review);
      }
      telemetry.milestone("commentary_viewed");
      telemetry.markActive("study");
      return true;
    }
  }
}
