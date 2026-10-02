import { describe, expect, it } from "vitest";
import { missedBetween } from "./time-asleep";

const at = (monotonic: number, wall: number, uptimeMs: number) => ({ monotonic, wall, uptimeMs });

describe("missedBetween", () => {
  it("is the precise wall-clock figure when it agrees with the uptime", () => {
    // Ten minutes asleep; uptime only to the second.
    expect(missedBetween(at(1_000, 5_000_000, 90_000_000), at(2_250, 5_601_250, 90_601_000))).toBe(600_000);
  });

  it("ignores a system-clock change during sleep", () => {
    // Asleep 30 s, but the clock was set a day ahead meanwhile: the uptime is believed.
    const day = 24 * 60 * 60 * 1000;
    expect(missedBetween(at(1_000, 5_000_000, 90_000_000), at(1_000, 5_030_000 + day, 90_030_000))).toBe(30_000);
    // Set back instead: still the uptime, and never negative.
    expect(missedBetween(at(1_000, 5_000_000, 90_000_000), at(1_000, 5_030_000 - day, 90_030_000))).toBe(30_000);
  });

  it("is zero when nothing was missed", () => {
    expect(missedBetween(at(1_000, 5_000_000, 90_000_000), at(3_000, 5_002_000, 90_002_000))).toBe(0);
  });
});
