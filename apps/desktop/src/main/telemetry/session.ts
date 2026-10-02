import { randomBytes } from "node:crypto";

/** A session ends after this long without an event (PostHog's own web default). */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
/** PostHog splits sessions longer than a day, so a window left open starts a new one by then. */
export const SESSION_MAX_MS = 24 * 60 * 60 * 1000;

/**
 * A UUIDv7 for `ms` (RFC 9562: 48-bit Unix milliseconds, version 7, random rest). PostHog reads
 * a session's start time from its `$session_id`, so it must be a v7 UUID.
 */
export function uuidv7(ms: number): string {
  const bytes = randomBytes(16);
  let timestamp = Math.max(0, Math.floor(ms));
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp % 256;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * PostHog's `$session_id`: one id while the app is in use, a new one after
 * {@link SESSION_IDLE_MS} without events or once a session reaches {@link SESSION_MAX_MS}.
 */
export class TelemetrySession {
  private id: string | null = null;
  private startedAt = 0;
  private lastEventAt = 0;

  /** The session an event recorded at `now` belongs to (starting a new one when due). */
  current(now: number): string {
    if (
      !this.id ||
      now - this.lastEventAt >= SESSION_IDLE_MS ||
      now - this.startedAt >= SESSION_MAX_MS ||
      now < this.lastEventAt
    ) {
      this.id = uuidv7(now);
      this.startedAt = now;
    }
    this.lastEventAt = now;
    return this.id;
  }
}
