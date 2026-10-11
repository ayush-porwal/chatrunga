import type { EngineGoClock } from "@chaturanga/shared/types/engine";
import type { Color } from "@chaturanga/shared/types/chess";

export type EngineClockConfig = {
  initialMs: number;
  incrementMs: number;
};

export type EngineClockLive = {
  whiteMs: number;
  blackMs: number;
  turnStartedAt: number;
  sideToMove: Color;
  /** Set when the game ends (mate, resignation, draw, flag): the clocks freeze at this moment. */
  stoppedAt?: number;
  /** With `stoppedAt`: frozen only for now (the engine's search was set aside), not ended. */
  paused?: boolean;
};

/**
 * Both clocks after `movedSide`'s move at `now`: the mover is charged the time since its turn
 * began and gets the increment; the other side's clock runs from now. Null when it wasn't the
 * mover's turn on the clock, or the clock is stopped.
 */
export function clockAfterMove(
  cfg: EngineClockConfig,
  live: EngineClockLive,
  movedSide: Color,
  now: number
): EngineClockLive | null {
  if (live.sideToMove !== movedSide || live.stoppedAt !== undefined) return null;
  const charge = (ms: number) => Math.max(0, ms - (now - live.turnStartedAt) + cfg.incrementMs);
  return {
    whiteMs: movedSide === "white" ? charge(live.whiteMs) : live.whiteMs,
    blackMs: movedSide === "black" ? charge(live.blackMs) : live.blackMs,
    turnStartedAt: now,
    sideToMove: movedSide === "white" ? "black" : "white"
  };
}

/**
 * `mover`'s turn running again, its last move being replaced: that move's increment
 * (`takeBackMs`) comes off its clock, and the turn runs from when it began (from the pause, when
 * the clock is paused).
 */
export function restartTurn(
  live: EngineClockLive,
  mover: Color,
  takeBackMs: number
): EngineClockLive {
  return {
    whiteMs: mover === "white" ? Math.max(0, live.whiteMs - takeBackMs) : live.whiteMs,
    blackMs: mover === "black" ? Math.max(0, live.blackMs - takeBackMs) : live.blackMs,
    sideToMove: mover,
    turnStartedAt: live.paused && live.stoppedAt !== undefined ? live.stoppedAt : live.turnStartedAt
  };
}

/** Milliseconds as a PGN `[%clk]` time, to the tenth below ("0:01:59.5", "0:03:00"). */
export function clockTag(ms: number): string {
  const tenths = Math.max(0, Math.floor(ms / 100));
  const seconds = Math.floor(tenths / 10);
  const pad = (value: number) => String(value).padStart(2, "0");
  const fraction = tenths % 10 ? `.${tenths % 10}` : "";
  return `${Math.floor(seconds / 3600)}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}${fraction}`;
}

export function buildEngineGoClock(
  live: EngineClockLive,
  cfg: EngineClockConfig,
  now: number
): EngineGoClock {
  const elapsed = now - live.turnStartedAt;
  let w = live.whiteMs;
  let b = live.blackMs;
  if (live.sideToMove === "white") w -= elapsed;
  else b -= elapsed;
  return {
    wtime: Math.max(1, Math.floor(w)),
    btime: Math.max(1, Math.floor(b)),
    winc: Math.max(0, Math.floor(cfg.incrementMs)),
    binc: Math.max(0, Math.floor(cfg.incrementMs))
  };
}

export function stopClock(live: EngineClockLive | null): EngineClockLive | null {
  if (!live) return live;
  // A paused clock ends frozen where it was paused.
  if (live.paused) return { ...live, paused: false };
  return live.stoppedAt === undefined ? { ...live, stoppedAt: clockNow() } : live;
}

/** Where the time asleep comes from (the main process; tests swap it). */
let readTimeAsleep: () => number = () =>
  typeof window === "undefined" ? 0 : (window.chaturanga?.system.timeAsleepMs() ?? 0);

/**
 * A wall-clock step this far past the monotonic one means the computer may have slept. Small, so
 * even a sub-second suspend is read before a move is timed (not left to the wake notice, which can
 * arrive after it), yet above the millisecond jitter between the two clocks, so a normal check
 * never asks the main process.
 */
const SUSPECT_SLEEP_MS = 25;
let lastMonotonic = performance.now();
let lastWall = Date.now();
/**
 * Main's total since the app started, read once now: a renderer reloaded later would otherwise
 * start from 0 and add every earlier sleep at its first check, jumping a running clock forward.
 */
let timeAsleep = readTimeAsleep();
/** The main process said the computer woke up: read the total at the next clock check. */
let resumedSinceRead = false;

/**
 * The time base for match clocks: monotonic, so changing the system clock (or an NTP correction)
 * never adds or removes thinking time. Only differences between two readings mean anything.
 * `performance.now()` may stop while the computer sleeps, so the time it missed is added back —
 * as the main process measured it (from suspend to resume, not from wall-clock jumps). That is
 * read synchronously only when the two clocks drift apart since the last reading, which a sleep
 * always causes: a clock check never waits on the main process otherwise.
 */
export function clockNow(): number {
  const monotonic = performance.now();
  const wall = Date.now();
  if (resumedSinceRead || wall - lastWall - (monotonic - lastMonotonic) > SUSPECT_SLEEP_MS) {
    timeAsleep = readTimeAsleep();
    resumedSinceRead = false;
  }
  lastMonotonic = monotonic;
  lastWall = wall;
  return monotonic + timeAsleep;
}

/** The computer woke up (main's notice): the next clock check reads the time asleep. */
export function noteSystemResumed(): void {
  resumedSinceRead = true;
}

export function setTimeAsleepSource(source: () => number): void {
  readTimeAsleep = source;
}

/** Time left on `side`'s clock at `now` (the running side's clock counts down; a stopped game is frozen). */
export function remainingClockMs(live: EngineClockLive, side: Color, now: number): number {
  const at = live.stoppedAt === undefined ? now : Math.min(now, live.stoppedAt);
  const elapsed = live.sideToMove === side ? Math.max(0, at - live.turnStartedAt) : 0;
  return Math.max(0, (side === "white" ? live.whiteMs : live.blackMs) - elapsed);
}
