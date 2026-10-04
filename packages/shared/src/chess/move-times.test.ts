import { describe, expect, it } from "vitest";
import { moveTimes, parseClock, parseTimeControl, timeSpentForMove } from "./move-times";

describe("move times from [%clk]", () => {
  it("uses the mover's own previous clock plus increment", () => {
    const moves = [
      { clockAfter: "0:10:00" }, // white
      { clockAfter: "0:09:50" }, // black
      { clockAfter: "0:09:30" }, // white spent 30s, +5 inc
      { clockAfter: "0:09:48" } // black spent 2s, +5 inc
    ];
    const tc = parseTimeControl("600+5");
    expect(tc).toEqual({ baseMs: 600_000, incrementMs: 5000 });
    expect(timeSpentForMove(moves, 2, tc)).toBe(35_000);
    expect(timeSpentForMove(moves, 3, tc)).toBe(7000);
    expect(timeSpentForMove(moves, 1, tc)).toBe(15_000);
    expect(timeSpentForMove(moves, 1, null)).toBeUndefined();
    expect(parseTimeControl("-")).toBeNull();
  });

  it("reads clocks with and without hours, and tenths", () => {
    expect(parseClock("0:04:58")).toBe(298_000);
    expect(parseClock("4:58")).toBe(298_000);
    expect(parseClock("0:00:09.5")).toBe(9500);
    expect(parseClock("soon")).toBeNull();
    expect(parseClock(null)).toBeNull();
  });

  it("times every move of a line, the first ones from the time control's base", () => {
    const line = [
      { clockAfter: "0:02:58" },
      { clockAfter: "0:02:55" },
      { clockAfter: "0:02:41" },
      { clockAfter: null },
      { clockAfter: "0:02:30" },
      { clockAfter: "0:02:40" }
    ];
    // 3 + 2: each side's first move counts from 3:00, and every move gets the 2 s back. 2… has no
    // clock, and so 3…, whose clock has nothing of Black's to count from, has no time either.
    expect(moveTimes(line, "180+2")).toEqual([4000, 7000, 19_000, null, 13_000, null]);
    // Without a time control the first moves have no start, the later ones still have a delta.
    expect(moveTimes(line.slice(0, 3), "-")).toEqual([null, null, 17_000]);
  });

  it("is empty for a game without clocks", () => {
    expect(moveTimes([{}, {}], "600")).toEqual([null, null]);
  });
});
