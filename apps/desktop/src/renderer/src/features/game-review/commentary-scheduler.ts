import type { ReviewCommentary } from "@chaturanga/shared/types/engine";

/**
 * On-demand AI commentary policy. Nothing is requested while the engine pass runs or when it
 * finishes; a request is made only for the move the user is looking at (Commentary tab open),
 * after a short debounce so scrubbing through moves never fires a burst of provider calls.
 * Results are cached per ply in the review (and persisted with it), so revisiting is free.
 */

/** Time the user must settle on a move before its commentary is requested. */
export const COMMENTARY_DEBOUNCE_MS = 500;

/**
 * Fingerprint of the settings that change the prose. The leading "openrouter" segment is the
 * retired provider choice, kept so explanations saved by older builds still match.
 */
export function commentarySettingsKey(input: {
  model: string;
  detail: string;
  userRating: number;
  playerColor: "white" | "black";
}): string {
  return ["openrouter", input.model || "default", input.detail, input.userRating, input.playerColor].join("|");
}

/**
 * A cached explanation still matches the current settings. Explanations saved before settings
 * were fingerprinted count as current, so older saved reviews never re-query.
 */
export function isCurrentCommentary(item: ReviewCommentary | undefined, settingsKey: string): item is ReviewCommentary {
  return Boolean(item && (!item.settingsKey || item.settingsKey === settingsKey));
}

export type CommentaryDecision =
  /** Review not ready / panel not visible / no move: do nothing. */
  | "idle"
  /** AI commentary is switched off in Review settings. */
  | "off"
  /** No OpenRouter API key is saved. */
  | "no-key"
  /** Saved settings or the OpenRouter configuration are still loading. */
  | "waiting"
  /** The engine data for this move is too thin to brief a model. */
  | "no-payload"
  /** Up-to-date AI commentary is cached for this move. */
  | "cached"
  /** A request for this move already failed with these settings; wait for Retry. */
  | "failed"
  | "request";

export function decideCommentary(input: {
  /** Review finished (not running) and the Commentary tab shows a reviewed move. */
  active: boolean;
  enabled: boolean;
  configLoading: boolean;
  hasApiKey: boolean;
  hasPayload: boolean;
  cached: ReviewCommentary | undefined;
  settingsKey: string;
  failed: boolean;
}): CommentaryDecision {
  if (!input.active) return "idle";
  if (!input.enabled) return "off";
  if (isCurrentCommentary(input.cached, input.settingsKey)) return "cached";
  if (input.configLoading) return "waiting";
  if (!input.hasApiKey) return "no-key";
  if (!input.hasPayload) return "no-payload";
  if (input.failed) return "failed";
  return "request";
}

export type CommentaryJob = {
  /** Identity of the request: review + ply + settings. */
  key: string;
  run: () => Promise<void>;
};

/**
 * Debounces the "user is viewing this move" signal into at most one request per settled move
 * and never runs two requests with the same key at once.
 */
export class CommentaryScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingKey: string | null = null;
  private readonly inFlight = new Set<string>();

  constructor(private readonly delayMs = COMMENTARY_DEBOUNCE_MS) {}

  /** The move now in view (or null). Replaces any request that has not started yet. */
  schedule(job: CommentaryJob | null): void {
    if (job && job.key === this.pendingKey) return;
    this.cancelPending();
    if (!job || this.inFlight.has(job.key)) return;
    this.pendingKey = job.key;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pendingKey = null;
      this.start(job);
    }, this.delayMs);
  }

  /** Explicit user action (Retry): skip the debounce. */
  runNow(job: CommentaryJob): void {
    this.cancelPending();
    this.start(job);
  }

  isBusy(key: string): boolean {
    return this.pendingKey === key || this.inFlight.has(key);
  }

  dispose(): void {
    this.cancelPending();
  }

  private cancelPending(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pendingKey = null;
  }

  private start(job: CommentaryJob): void {
    if (this.inFlight.has(job.key)) return;
    this.inFlight.add(job.key);
    void job.run().catch(() => undefined).finally(() => this.inFlight.delete(job.key));
  }
}
