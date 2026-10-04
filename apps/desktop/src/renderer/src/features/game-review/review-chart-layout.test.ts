import { describe, expect, it } from "vitest";
import {
  CHARTS_MIN_HEIGHT,
  chartsMaxHeight,
  clampChartsHeight,
  CONTENT_MIN_HEIGHT,
  defaultChartsHeight,
  fitViewHeights,
  resolveChartsHeight,
  splitViewHeights,
  STRIP_MIN,
  viewHeights,
  WIN_MIN,
  type ChartsLayout
} from "./review-chart-layout";

const ALL: ChartsLayout = { win: "open", difficulty: "open", times: "open" };
const BOTH = { win: true, difficulty: true, times: true };

describe("review chart layout", () => {
  it("keeps the height between the minimum and what leaves the content its room", () => {
    // Content 400 high under 200 of charts: the charts can take all but the content's 160.
    const max = chartsMaxHeight(400, 200);
    expect(max).toBe(200 + 400 - CONTENT_MIN_HEIGHT);
    expect(clampChartsHeight(300, max)).toBe(300);
    expect(clampChartsHeight(900, max)).toBe(max);
    expect(clampChartsHeight(40, max)).toBe(CHARTS_MIN_HEIGHT);
    // A panel too short for both: the charts keep their minimum.
    expect(clampChartsHeight(300, chartsMaxHeight(20, 130))).toBe(CHARTS_MIN_HEIGHT);
    // Before the panel is measured only the minimum applies.
    expect(chartsMaxHeight(null, 200)).toBeNull();
    expect(clampChartsHeight(1234.4, null)).toBe(1234);
  });

  it("shares the height equally among the views shown", () => {
    expect(splitViewHeights(450, BOTH)).toEqual({ win: 150, difficulty: 150, times: 150 });
    // Without clocks (or with Move times folded) the two views share it in halves.
    expect(splitViewHeights(300, { win: true, difficulty: true, times: false })).toEqual({
      win: 150,
      difficulty: 150,
      times: null
    });
    expect(splitViewHeights(250, { win: true, difficulty: false, times: false })).toEqual({
      win: 250,
      difficulty: null,
      times: null
    });
    // Rounding leftovers go to winning chances, so the views fill the space.
    const odd = splitViewHeights(451, BOTH);
    expect(odd).toEqual({ win: 151, difficulty: 150, times: 150 });
  });

  it("gives a folded winning-chances view's share to the strips", () => {
    expect(splitViewHeights(300, { win: false, difficulty: true, times: true })).toEqual({
      win: null,
      difficulty: 150,
      times: 150
    });
    // Everything folded: nothing to share.
    expect(splitViewHeights(300, { win: false, difficulty: false, times: false })).toEqual({
      win: null,
      difficulty: null,
      times: null
    });
    const folded: ChartsLayout = { win: "folded", difficulty: "open", times: "open" };
    expect(defaultChartsHeight(folded)).toBeLessThan(defaultChartsHeight(ALL));
    expect(viewHeights(defaultChartsHeight(ALL), folded).win).toBeNull();
  });

  it("keeps every view at its minimum, sharing what is left among the others", () => {
    // 240 px: thirds of 80 put winning chances under its 100; the strips share the 140 left.
    expect(splitViewHeights(240, BOTH)).toEqual({ win: 100, difficulty: 70, times: 70 });
    // 300 px: thirds clear every minimum.
    expect(splitViewHeights(300, BOTH)).toEqual({ win: 100, difficulty: 100, times: 100 });
    // Too little for every minimum: each at its minimum (the charts scroll).
    expect(splitViewHeights(100, BOTH)).toEqual({
      win: WIN_MIN,
      difficulty: STRIP_MIN,
      times: STRIP_MIN
    });
  });

  it("defaults lower as strips fold or go", () => {
    const all = defaultChartsHeight(ALL);
    const folded = defaultChartsHeight({ win: "open", difficulty: "folded", times: "folded" });
    const prompt = defaultChartsHeight({ win: "open", difficulty: "prompt", times: "none" });
    const winOnly = defaultChartsHeight({ win: "open", difficulty: "none", times: "none" });
    expect(all).toBeGreaterThan(folded);
    expect(folded).toBeGreaterThan(prompt);
    expect(prompt).toBeGreaterThan(winOnly);
    expect(winOnly).toBeGreaterThanOrEqual(CHARTS_MIN_HEIGHT);
    // At the default winning chances keeps its minimum; taller, the views grow alike.
    expect(viewHeights(all, ALL)).toEqual({ win: 100, difficulty: 70, times: 70 });
    expect(viewHeights(all + 150, ALL)).toEqual({ win: 130, difficulty: 130, times: 130 });
  });

  it("fills the panel when Review is folded, whatever the splitter was set to", () => {
    const base = { stored: 180, max: 300, layout: ALL };
    // Folded Review: the measured height, never capped by the splitter or the content's room.
    expect(resolveChartsHeight({ ...base, fill: true, measured: 640 })).toBe(640);
    // Even below the views' minimums (they scroll then), and before measuring, the default.
    expect(resolveChartsHeight({ ...base, fill: true, measured: 90 })).toBe(90);
    expect(resolveChartsHeight({ ...base, fill: true, measured: null })).toBe(
      defaultChartsHeight(ALL)
    );
    // Review open: the splitter's height, clamped; reset, the default.
    expect(resolveChartsHeight({ ...base, fill: false, measured: 640 })).toBe(180);
    expect(resolveChartsHeight({ ...base, stored: 900, fill: false, measured: null })).toBe(300);
    expect(
      resolveChartsHeight({ ...base, stored: null, max: null, fill: false, measured: null })
    ).toBe(defaultChartsHeight(ALL));
  });

  it("fits the open views and the measured rows into the views area exactly", () => {
    const total = (heights: ReturnType<typeof fitViewHeights>) =>
      (heights.win ?? 0) + (heights.difficulty ?? 0) + (heights.times ?? 0);
    // Three strips: three labels and the axis around them, 7 rows and 6 gaps of 4.
    const chrome3 = [20, 20, 20, 13];
    const three = fitViewHeights({ container: 600, chrome: chrome3, open: BOTH, gap: 4 });
    expect(total(three) + 73 + 6 * 4).toBe(600);
    expect(three).toEqual({ win: 169, difficulty: 167, times: 167 });
    // Two (Move times folded: its label stays), and one with the Maia note in its place.
    const two = { win: true, difficulty: true, times: false };
    const twoFit = fitViewHeights({ container: 600, chrome: chrome3, open: two, gap: 4 });
    expect(total(twoFit) + 73 + 5 * 4).toBe(600);
    const one = { win: true, difficulty: false, times: false };
    const oneFit = fitViewHeights({ container: 500, chrome: [20, 16, 13], open: one, gap: 4 });
    expect(oneFit).toEqual({ win: 500 - 49 - 3 * 4, difficulty: null, times: null });
    // Below the minimums the views keep them and overflow; the area scrolls.
    const tight = fitViewHeights({ container: 200, chrome: chrome3, open: BOTH, gap: 4 });
    expect(total(tight)).toBe(WIN_MIN + 2 * STRIP_MIN);
  });
});
