import { describe, expect, it } from "vitest";
import { formatLiveClock, msUntilNextChange } from "./EngineClock";
import { remainingClockMs } from "../../stores/game-store";

describe("live engine clock", () => {
  it("shows M:SS, then tenths in the last ten seconds", () => {
    expect(formatLiveClock(180_000)).toBe("3:00");
    expect(formatLiveClock(10_000)).toBe("0:10");
    expect(formatLiveClock(9_950)).toBe("0:10");
    expect(formatLiveClock(9_900)).toBe("0:09.9");
    expect(formatLiveClock(4_321)).toBe("0:04.4");
    expect(formatLiveClock(0)).toBe("0:00");
  });

  it("wakes exactly when the text changes", () => {
    expect(msUntilNextChange(12_300)).toBe(300);
    expect(msUntilNextChange(12_000)).toBe(1000);
    expect(msUntilNextChange(4_321)).toBe(21);
  });

  it("freezes both clocks when the game has stopped", () => {
    const live = { whiteMs: 60_000, blackMs: 50_000, turnStartedAt: 1_000, sideToMove: "white" as const, stoppedAt: 6_000 };
    expect(remainingClockMs(live, "white", 100_000)).toBe(55_000);
    expect(remainingClockMs(live, "black", 100_000)).toBe(50_000);
    expect(remainingClockMs({ ...live, stoppedAt: undefined }, "white", 11_000)).toBe(50_000);
  });
});
