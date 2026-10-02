/**
 * Usage analytics (optional, off until the user turns it on; see docs/telemetry.md).
 *
 * The main process owns identity, common metadata and delivery. The renderer may only report the
 * few interactions below: each has a fixed shape, and main validates it again before recording.
 * Nothing here carries game content (PGN/FEN, names, URLs), file paths, keys or AI text.
 */

/** What the user was doing when the app counted them as active (meaningful, foreground use). */
export const TELEMETRY_ACTIVITY_KINDS = ["study", "play", "puzzle"] as const;
export type TelemetryActivityKind = (typeof TELEMETRY_ACTIVITY_KINDS)[number];

/** Where a viewed explanation came from: written for this view, or kept from earlier. */
export const COMMENTARY_VIEW_SOURCES = ["fresh", "cached"] as const;
export type CommentaryViewSource = (typeof COMMENTARY_VIEW_SOURCES)[number];

/**
 * The interactions the renderer reports. `reviewId` is the review's operation id (null for a
 * review saved before reviews had one); `gameId` is the library game id, which main turns into a
 * per-installation pseudonym before anything is recorded.
 */
export type TelemetryRendererEvent =
  /** Meaningful foreground use (a move studied, played or solved right after user input). */
  | { type: "activity"; kind: TelemetryActivityKind }
  /** A saved review was shown on the Game review page (not one just produced by a run). */
  | { type: "review_opened"; reviewId: string | null; gameId: string | null }
  /** The user worked through a review: {@link REVIEW_STUDIED_MOVES} distinct moves selected. */
  | { type: "review_studied"; reviewId: string | null; gameId: string | null }
  /** An explanation stayed in view {@link COMMENTARY_VIEW_QUALIFY_MS} with the window in front. */
  | {
      type: "commentary_viewed";
      reviewId: string | null;
      gameId: string | null;
      ply: number;
      source: CommentaryViewSource;
    };

/** A review counts as studied once this many distinct moves of it were selected in one session. */
export const REVIEW_STUDIED_MOVES = 3;
/** An explanation counts as viewed after this long in view, window focused and visible. */
export const COMMENTARY_VIEW_QUALIFY_MS = 2_000;

/** Why usage data isn't being collected (shown in Settings). */
export type TelemetryUnavailableReason =
  /** This build has no analytics project configured. */
  | "not_configured"
  /** `CHATURANGA_TELEMETRY_ENABLED=false` in the environment. */
  | "disabled_by_environment"
  /** A development, test or automation run (delivery needs an explicit opt-in there). */
  | "development";

export type TelemetryStatus = {
  /** Collection can be turned on in this build and environment. */
  available: boolean;
  reason: TelemetryUnavailableReason | null;
  /** The user's choice (Settings → Privacy). */
  enabled: boolean;
  /** Events waiting to be sent (kept across restarts while offline). */
  pending: number;
};

/** How a commentary request was started: on its own when the move was shown, or by Retry. */
export type CommentaryTrigger = "auto" | "user_retry";

/** Correlation for a commentary request (optional; nothing about the game's content). */
export type CommentaryRequestContext = {
  reviewId: string | null;
  gameId: string | null;
  trigger: CommentaryTrigger;
};
