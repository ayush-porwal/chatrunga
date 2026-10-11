import { speedForClock, speedLabel, type LichessClockPreset } from "../lichess/lichess-game";

/** The engine game's clock choices, in slider order (no clock first, Custom last). */
export type EngineClockPresetId =
  | "infinite"
  | "bullet2_1"
  | "bullet3_0"
  | "blitz5_0"
  | "blitz5_3"
  | "rapid15_10"
  | "custom";

export const ENGINE_CLOCK_PRESETS: readonly {
  id: EngineClockPresetId;
  /** Null: no clock (infinite) or Custom (the minutes come from the steppers). */
  clock: LichessClockPreset | null;
}[] = [
  { id: "infinite", clock: null },
  { id: "bullet2_1", clock: { minutes: 2, incrementSec: 1 } },
  { id: "bullet3_0", clock: { minutes: 3, incrementSec: 0 } },
  { id: "blitz5_0", clock: { minutes: 5, incrementSec: 0 } },
  { id: "blitz5_3", clock: { minutes: 5, incrementSec: 3 } },
  { id: "rapid15_10", clock: { minutes: 15, incrementSec: 10 } },
  { id: "custom", clock: null }
];

/** A saved preset id, or no clock for one this build doesn't have. */
export function engineClockPreset(id: string): EngineClockPresetId {
  return ENGINE_CLOCK_PRESETS.find((preset) => preset.id === id)?.id ?? "infinite";
}

/**
 * The slider stop of a Lichess clock: the preset with its minutes and increment (a restored preset
 * is a copy, not the list's own object), else the first.
 */
export function presetIndex(
  presets: readonly LichessClockPreset[],
  preset: LichessClockPreset
): number {
  return Math.max(
    0,
    presets.findIndex(
      (item) => item.minutes === preset.minutes && item.incrementSec === preset.incrementSec
    )
  );
}

/** "Blitz · 5 min + 3 s": Lichess's speed band for the clock, then the clock itself. */
export function clockText(clock: LichessClockPreset): string {
  const speed = speedLabel(speedForClock(clock.minutes, clock.incrementSec));
  return `${speed} · ${clock.minutes} min + ${clock.incrementSec} s`;
}

/** The engine slider's value as words ("No clock", "Custom · 10 min + 5 s", "Rapid · 15 min + 10 s"). */
export function engineClockText(id: EngineClockPresetId, custom: LichessClockPreset): string {
  if (id === "infinite") return "No clock";
  if (id === "custom") return `Custom · ${custom.minutes} min + ${custom.incrementSec} s`;
  const clock = ENGINE_CLOCK_PRESETS.find((preset) => preset.id === id)?.clock;
  return clock ? clockText(clock) : "No clock";
}

/** The engine game's clock in ms, or null for no clock. Custom never goes below 30 seconds. */
export function engineClockMs(
  id: EngineClockPresetId,
  custom: LichessClockPreset
): { initialMs: number; incrementMs: number } | null {
  if (id === "custom") {
    return {
      initialMs: Math.max(30_000, Math.round(custom.minutes * 60_000)),
      incrementMs: Math.max(0, Math.round(custom.incrementSec * 1000))
    };
  }
  const clock = ENGINE_CLOCK_PRESETS.find((preset) => preset.id === id)?.clock;
  return clock
    ? { initialMs: clock.minutes * 60_000, incrementMs: clock.incrementSec * 1000 }
    : null;
}

/* ------------------------------------------------------------------ slider */

/** Where a stop sits along the track, in percent (a single stop sits in the middle). */
export function stopPercent(index: number, count: number): number {
  return count <= 1 ? 50 : (index / (count - 1)) * 100;
}

/**
 * The pointer's place along the track as a stop index, fractional while dragging, held to the
 * track's ends.
 */
export function stopAtPointer(
  clientX: number,
  trackLeft: number,
  trackWidth: number,
  count: number
) {
  if (count <= 1 || trackWidth <= 0) return 0;
  const fraction = (clientX - trackLeft) / trackWidth;
  return Math.min(count - 1, Math.max(0, fraction * (count - 1)));
}

/** The stop a fractional position snaps to on release. */
export function nearestStop(position: number, count: number): number {
  return Math.min(Math.max(0, count - 1), Math.max(0, Math.round(position)));
}

/** The stop a key moves to (arrows step, Home/End jump); null for any other key. */
export function stopForKey(key: string, index: number, count: number): number | null {
  const last = Math.max(0, count - 1);
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return Math.min(last, index + 1);
    case "ArrowLeft":
    case "ArrowDown":
      return Math.max(0, index - 1);
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ custom clock */

export const CUSTOM_MINUTES = { min: 1, max: 180 } as const;
export const CUSTOM_INCREMENT = { min: 0, max: 60 } as const;

/**
 * Custom minutes one step up or down: single minutes below 10, then steps of 5 (a value between
 * steps, from an older build, lands on the step), held to 1–180.
 */
export function stepMinutes(value: number, direction: 1 | -1): number {
  const current = Math.round(Number.isFinite(value) ? value : 10);
  let next: number;
  if (direction > 0) next = current < 10 ? current + 1 : (Math.floor(current / 5) + 1) * 5;
  else next = current <= 10 ? current - 1 : Math.ceil(current / 5) * 5 - 5;
  return Math.min(CUSTOM_MINUTES.max, Math.max(CUSTOM_MINUTES.min, next));
}

/** Custom increment one second up or down, held to 0–60. */
export function stepIncrement(value: number, direction: 1 | -1): number {
  const current = Math.round(Number.isFinite(value) ? value : 0);
  return Math.min(CUSTOM_INCREMENT.max, Math.max(CUSTOM_INCREMENT.min, current + direction));
}

/** A running search or wait as a clock: "0:07", "12:30". */
export function formatElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
