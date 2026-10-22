import { describe, expect, it } from "vitest";
import { columnForKey, nearestColumn, niceStep, niceTicks } from "./chart";

describe("chart interaction", () => {
  const xs = [34, 108, 182, 256, 330];

  it("snaps the pointer to the nearest rating column", () => {
    expect(nearestColumn(150, xs)).toBe(2);
  });

  it("snaps a pointer left of the plot to the first column", () => {
    expect(nearestColumn(0, xs)).toBe(0);
  });

  it("steps right one column", () => {
    expect(columnForKey("ArrowRight", 2, 5, 2)).toBe(3);
  });

  it("stays on the last column at the right end", () => {
    expect(columnForKey("ArrowRight", 4, 5, 2)).toBe(4);
  });

  it("starts at the user's column when none is shown", () => {
    expect(columnForKey("ArrowLeft", null, 5, 2)).toBe(2);
  });

  it("jumps to the first column with Home", () => {
    expect(columnForKey("Home", 3, 5, 2)).toBe(0);
  });

  it("jumps to the last column with End", () => {
    expect(columnForKey("End", 1, 5, 2)).toBe(4);
  });

  it("clears with Escape", () => {
    expect(columnForKey("Escape", 3, 5, 2)).toBeNull();
  });

  it("leaves other keys alone", () => {
    expect(columnForKey("Enter", 3, 5, 2)).toBeUndefined();
  });
});

describe("niceTicks", () => {
  it("widens the range out to round steps", () => {
    expect(niceTicks(1432, 1611)).toStrictEqual({
      min: 1400,
      max: 1650,
      ticks: [1400, 1450, 1500, 1550, 1600, 1650]
    });
  });

  it("pads a flat range by a step each way", () => {
    expect(niceTicks(1500, 1500)).toStrictEqual({
      min: 1000,
      max: 2000,
      ticks: [1000, 1500, 2000]
    });
  });

  it("steps in halves when the range is small", () => {
    expect(niceTicks(1, 3, 4).ticks).toStrictEqual([1, 1.5, 2, 2.5, 3]);
  });

  it("keeps decimal steps exact", () => {
    expect(niceTicks(0, 0.3, 3).ticks).toStrictEqual([0, 0.1, 0.2, 0.3]);
  });
});

describe("niceStep", () => {
  it("rounds up to 1, 2, 2.5 or 5 times a power of ten", () => {
    expect(niceStep(0.7)).toBe(1);
    expect(niceStep(22)).toBe(25);
    expect(niceStep(380)).toBe(500);
  });

  it("counts in whole 1, 2 or 5 steps", () => {
    expect(niceStep(0.3, true)).toBe(1);
    expect(niceStep(2.2, true)).toBe(5);
    expect(niceStep(16, true)).toBe(20);
  });
});
