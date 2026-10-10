import { describe, expect, it } from "vitest";
import {
  clockText,
  engineClockMs,
  engineClockPreset,
  engineClockText,
  formatElapsed,
  nearestStop,
  stepIncrement,
  stepMinutes,
  stopAtPointer,
  stopForKey,
  stopPercent
} from "./time-control";

describe("clock text", () => {
  it("names the Lichess speed band before the clock", () => {
    expect(clockText({ minutes: 5, incrementSec: 3 })).toBe("Blitz · 5 min + 3 s");
    expect(clockText({ minutes: 2, incrementSec: 1 })).toBe("Bullet · 2 min + 1 s");
    expect(clockText({ minutes: 15, incrementSec: 10 })).toBe("Rapid · 15 min + 10 s");
    expect(clockText({ minutes: 30, incrementSec: 20 })).toBe("Classical · 30 min + 20 s");
  });

  it("reads no clock and Custom with its own minutes", () => {
    const custom = { minutes: 12, incrementSec: 4 };
    expect(engineClockText("infinite", custom)).toBe("No clock");
    expect(engineClockText("custom", custom)).toBe("Custom · 12 min + 4 s");
    expect(engineClockText("blitz5_0", custom)).toBe("Blitz · 5 min + 0 s");
  });

  it("falls back to no clock for an unknown preset id", () => {
    expect(engineClockPreset("rapid10_0")).toBe("infinite");
    expect(engineClockPreset("rapid15_10")).toBe("rapid15_10");
  });

  it("gives the engine game's clock in ms, Custom at least 30 seconds", () => {
    const custom = { minutes: 0.2, incrementSec: 2 };
    expect(engineClockMs("infinite", custom)).toBeNull();
    expect(engineClockMs("blitz5_3", custom)).toEqual({ initialMs: 300_000, incrementMs: 3000 });
    expect(engineClockMs("custom", custom)).toEqual({ initialMs: 30_000, incrementMs: 2000 });
  });
});

describe("time control slider", () => {
  it("places stops evenly, a single stop in the middle", () => {
    expect(stopPercent(0, 7)).toBe(0);
    expect(stopPercent(3, 7)).toBe(50);
    expect(stopPercent(6, 7)).toBe(100);
    expect(stopPercent(0, 1)).toBe(50);
  });

  it("follows the pointer along the track, held to its ends, and snaps to the nearest stop", () => {
    // A 300px track at x=100 with 5 stops: one stop every 75px.
    expect(stopAtPointer(100, 100, 300, 5)).toBe(0);
    expect(stopAtPointer(250, 100, 300, 5)).toBe(2);
    expect(stopAtPointer(40, 100, 300, 5)).toBe(0);
    expect(stopAtPointer(900, 100, 300, 5)).toBe(4);
    expect(nearestStop(stopAtPointer(210, 100, 300, 5), 5)).toBe(1);
    expect(nearestStop(stopAtPointer(215, 100, 300, 5), 5)).toBe(2);
    expect(nearestStop(9, 5)).toBe(4);
    expect(stopAtPointer(250, 100, 0, 5)).toBe(0);
  });

  it("steps with the arrow keys and jumps with Home/End, ignoring other keys", () => {
    expect(stopForKey("ArrowRight", 2, 5)).toBe(3);
    expect(stopForKey("ArrowLeft", 2, 5)).toBe(1);
    expect(stopForKey("ArrowUp", 4, 5)).toBe(4);
    expect(stopForKey("ArrowDown", 0, 5)).toBe(0);
    expect(stopForKey("Home", 3, 5)).toBe(0);
    expect(stopForKey("End", 1, 5)).toBe(4);
    expect(stopForKey("Enter", 1, 5)).toBeNull();
  });
});

describe("custom clock steppers", () => {
  it("steps minutes by one below 10, then by five, within 1–180", () => {
    expect(stepMinutes(9, 1)).toBe(10);
    expect(stepMinutes(10, 1)).toBe(15);
    expect(stepMinutes(10, -1)).toBe(9);
    expect(stepMinutes(15, -1)).toBe(10);
    expect(stepMinutes(1, -1)).toBe(1);
    expect(stepMinutes(180, 1)).toBe(180);
  });

  it("lands an off-step value on the next step", () => {
    expect(stepMinutes(12, 1)).toBe(15);
    expect(stepMinutes(12, -1)).toBe(10);
    expect(stepMinutes(0.5, 1)).toBe(2);
  });

  it("steps the increment by one second within 0–60", () => {
    expect(stepIncrement(5, 1)).toBe(6);
    expect(stepIncrement(0, -1)).toBe(0);
    expect(stepIncrement(60, 1)).toBe(60);
  });
});

describe("formatElapsed", () => {
  it("reads minutes and padded seconds", () => {
    expect(formatElapsed(7)).toBe("0:07");
    expect(formatElapsed(750)).toBe("12:30");
    expect(formatElapsed(-3)).toBe("0:00");
  });
});
