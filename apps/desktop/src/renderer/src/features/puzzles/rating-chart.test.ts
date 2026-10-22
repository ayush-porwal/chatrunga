import { describe, expect, it } from "vitest";
import {
  firstPuzzleNumber,
  ratingChange,
  ratingChart,
  themeRows,
  toggleTheme
} from "./rating-chart";

const history = [1500, 1532.4, 1488, 1611.6].map((rating, index) => ({ at: index, rating }));

describe("ratingChart", () => {
  const chart = ratingChart(history, 7, { width: 440, height: 200 })!;

  it("needs two ratings for a line", () => {
    expect(ratingChart(history.slice(0, 1), 1, { width: 440, height: 200 })).toBeNull();
  });

  it("puts the ratings on round ticks spanning every point", () => {
    expect(chart.yTicks.map((tick) => tick.label)).toStrictEqual([
      "1450",
      "1500",
      "1550",
      "1600",
      "1650"
    ]);
    const ys = chart.points.map((point) => point.y);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(chart.plot.top);
    expect(Math.max(...ys)).toBeLessThanOrEqual(chart.plot.bottom);
  });

  it("numbers the puzzles from the first shown, across the plot's width", () => {
    expect(chart.points.map((point) => [point.number, point.rating])).toStrictEqual([
      [7, 1500],
      [8, 1532],
      [9, 1488],
      [10, 1612]
    ]);
    expect(chart.points[0].x).toBe(chart.plot.left);
    expect(chart.points[3].x).toBe(chart.plot.right);
    // A higher rating sits higher.
    expect(chart.points[3].y).toBeLessThan(chart.points[0].y);
  });

  it("labels whole puzzle numbers, far enough apart", () => {
    const wide = ratingChart(
      Array.from({ length: 200 }, (_, index) => ({ at: index, rating: 1500 + index })),
      46,
      { width: 640, height: 200 }
    )!;
    const labels = wide.xTicks.map((tick) => Number(tick.label));
    expect(labels.filter((label) => !Number.isInteger(label))).toStrictEqual([]);
    expect(Math.min(...labels)).toBeGreaterThanOrEqual(46);
    expect(Math.max(...labels)).toBeLessThanOrEqual(245);
    const gaps = wide.xTicks.slice(1).map((tick, index) => tick.x - wide.xTicks[index].x);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(64);
  });
});

describe("rating history", () => {
  it("numbers the shown puzzles among all rated ones", () => {
    expect(firstPuzzleNumber(245, 200)).toBe(46);
    expect(firstPuzzleNumber(12, 12)).toBe(1);
  });

  it("measures the change from the first shown rating to the latest", () => {
    expect(ratingChange(history)).toBe(112);
    expect(ratingChange(history.slice(0, 1))).toBeNull();
  });
});

describe("themeRows", () => {
  it("lists the most played themes first, then by name, with the share solved", () => {
    const rows = themeRows([
      { theme: "pin", attempts: 4, solved: 1, performance: 1400 },
      { theme: "mateIn2", attempts: 9, solved: 6, performance: 1720 },
      { theme: "fork", attempts: 4, solved: 4, performance: null },
      { theme: "skewer", attempts: 0, solved: 0, performance: null }
    ]);
    expect(rows.map((row) => [row.label, row.share])).toStrictEqual([
      ["mate in 2", 6 / 9],
      ["fork", 1],
      ["pin", 0.25]
    ]);
  });
});

describe("toggleTheme", () => {
  it("adds a theme to the filter, or takes it out", () => {
    expect(toggleTheme(["fork"], "pin")).toStrictEqual(["fork", "pin"]);
    expect(toggleTheme(["fork", "pin"], "fork")).toStrictEqual(["pin"]);
  });
});
