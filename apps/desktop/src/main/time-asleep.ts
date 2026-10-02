import { uptime } from "node:os";

/** One reading of the clocks the sleep measurement compares. */
export type ClockReading = { monotonic: number; wall: number; uptimeMs: number };

/** How far the two measurements may differ before the wall clock is taken to have been changed. */
export const SLEEP_AGREEMENT_MS = 1_500;

export function readClocks(): ClockReading {
  return { monotonic: performance.now(), wall: Date.now(), uptimeMs: uptime() * 1000 };
}

/**
 * Time the monotonic clock missed between two readings (the computer slept). The wall clock gives
 * it to the millisecond but jumps when the system clock is changed (by hand, or a large sync after
 * waking); the OS uptime keeps counting through sleep without following such changes, but only to
 * the second on some systems. So: the wall-clock figure when the two agree, the uptime one when
 * they don't.
 */
export function missedBetween(from: ClockReading, to: ClockReading): number {
  const monotonic = to.monotonic - from.monotonic;
  const byWall = Math.max(0, to.wall - from.wall - monotonic);
  const byUptime = Math.max(0, to.uptimeMs - from.uptimeMs - monotonic);
  return Math.abs(byWall - byUptime) <= SLEEP_AGREEMENT_MS ? byWall : byUptime;
}
