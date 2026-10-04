import { describe, expect, it } from "vitest";
import { glicko2Update } from "./glicko2";
import {
  AROUND_RATING_WINDOW,
  DEFAULT_PUZZLE_RATING,
  isProvisional,
  isPuzzleDifficulty,
  MAX_DEVIATION,
  MAX_VOLATILITY,
  MIN_DEVIATION,
  PUZZLE_RATING_TAU,
  puzzlePerformance,
  rateAttempt,
  ratingAfterIdle,
  ratingRangeFor,
  RATING_PERIODS_PER_DAY
} from "./puzzle-rating";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 3, 12);
const PUZZLE = { rating: 1500, deviation: 75 };

describe("rateAttempt", () => {
  it("is one Glicko-2 game against the puzzle, with Lichess's τ", () => {
    const settled = { rating: 1600, deviation: 80, volatility: 0.06 };
    const expected = glicko2Update(settled, [{ opponent: PUZZLE, score: 1 }], PUZZLE_RATING_TAU);
    expect(rateAttempt(settled, PUZZLE, true, NOW)).toEqual(expected);
  });

  it("moves a new solver a long way on the first puzzle, and a settled one a little", () => {
    const first = rateAttempt(DEFAULT_PUZZLE_RATING, PUZZLE, true, NOW);
    expect(first.rating - 1500).toBeGreaterThan(150);
    expect(first.deviation).toBeLessThan(DEFAULT_PUZZLE_RATING.deviation);
    const settled = rateAttempt(
      { rating: 1500, deviation: 60, volatility: 0.06 },
      PUZZLE,
      true,
      NOW
    );
    expect(settled.rating - 1500).toBeGreaterThan(0);
    expect(settled.rating - 1500).toBeLessThan(15);
  });

  it("wins up and losses down; beating a harder puzzle gains more than an easier one", () => {
    const player = { rating: 1500, deviation: 100, volatility: 0.06 };
    const hard = rateAttempt(player, { rating: 1900, deviation: 75 }, true, NOW);
    const easy = rateAttempt(player, { rating: 1100, deviation: 75 }, true, NOW);
    expect(hard.rating - 1500).toBeGreaterThan(easy.rating - 1500);
    expect(easy.rating).toBeGreaterThan(1500);
    expect(rateAttempt(player, { rating: 1100, deviation: 75 }, false, NOW).rating).toBeLessThan(
      1500
    );
  });

  it("keeps the deviation within its bounds and the volatility under its cap", () => {
    let rating = DEFAULT_PUZZLE_RATING;
    for (let index = 0; index < 400; index += 1)
      rating = rateAttempt(rating, PUZZLE, index % 2 === 0, NOW);
    expect(rating.deviation).toBeGreaterThanOrEqual(MIN_DEVIATION);
    expect(rating.volatility).toBeLessThanOrEqual(MAX_VOLATILITY);
    // A wildly uncertain puzzle doesn't push the solver's deviation above the ceiling.
    const wild = rateAttempt(
      { rating: 1500, deviation: MAX_DEVIATION, volatility: MAX_VOLATILITY },
      { rating: 1500, deviation: 5000 },
      true,
      NOW
    );
    expect(wild.deviation).toBeLessThanOrEqual(MAX_DEVIATION);
  });

  it("widens the deviation for the idle time before rating", () => {
    const player = { rating: 1500, deviation: 60, volatility: 0.06 };
    const fresh = rateAttempt(player, PUZZLE, true, NOW, NOW - 60_000);
    const stale = rateAttempt(player, PUZZLE, true, NOW, NOW - 365 * DAY);
    // A wider deviation before the game moves the rating further.
    expect(stale.rating - 1500).toBeGreaterThan(fresh.rating - 1500);
  });

  it("falls back to the defaults for an unusable stored rating", () => {
    const broken = { rating: Number.NaN, deviation: Number.NaN, volatility: 0 };
    expect(rateAttempt(broken, PUZZLE, true, NOW)).toEqual(
      rateAttempt(DEFAULT_PUZZLE_RATING, PUZZLE, true, NOW)
    );
  });
});

describe("ratingAfterIdle", () => {
  const player = { rating: 1700, deviation: 60, volatility: 0.06 };

  it("adds σ² per rating period to the variance", () => {
    const days = 30;
    const periods = days * RATING_PERIODS_PER_DAY;
    const widened = ratingAfterIdle(player, NOW - days * DAY, NOW);
    expect(widened.deviation).toBeCloseTo(Math.sqrt(60 ** 2 + (0.06 * 173.7178) ** 2 * periods), 6);
    expect(widened.rating).toBe(1700);
  });

  it("is unchanged without a previous attempt or when the clock went backwards, and capped", () => {
    expect(ratingAfterIdle(player, null, NOW)).toEqual(player);
    expect(ratingAfterIdle(player, NOW + DAY, NOW)).toEqual(player);
    expect(ratingAfterIdle(player, NOW - 100 * 365 * DAY, NOW).deviation).toBe(MAX_DEVIATION);
  });
});

describe("isProvisional", () => {
  it("is provisional from a deviation of 110, as Lichess shows a '?'", () => {
    expect(isProvisional(DEFAULT_PUZZLE_RATING)).toBe(true);
    expect(isProvisional({ deviation: 110 })).toBe(true);
    expect(isProvisional({ deviation: 109.9 })).toBe(false);
  });
});

describe("puzzlePerformance", () => {
  it("is the average puzzle rating − 500 + 1000 × the share solved", () => {
    expect(puzzlePerformance(1600, 3, 4)).toBe(1850);
    expect(puzzlePerformance(1600, 0, 4)).toBe(1100);
    expect(puzzlePerformance(1600, 4, 4)).toBe(2100);
    expect(puzzlePerformance(1600, 0, 0)).toBeNull();
  });
});

describe("ratingRangeFor", () => {
  it("centres a window on the rating plus Lichess's difficulty offsets", () => {
    expect(ratingRangeFor(1500, "normal")).toEqual({
      ratingMin: 1500 - AROUND_RATING_WINDOW,
      ratingMax: 1500 + AROUND_RATING_WINDOW
    });
    expect(ratingRangeFor(1500, "easiest").ratingMin).toBe(900 - AROUND_RATING_WINDOW);
    expect(ratingRangeFor(1500, "easier").ratingMax).toBe(1200 + AROUND_RATING_WINDOW);
    expect(ratingRangeFor(1500, "harder").ratingMin).toBe(1800 - AROUND_RATING_WINDOW);
    expect(ratingRangeFor(1500, "hardest").ratingMax).toBe(2100 + AROUND_RATING_WINDOW);
  });

  it("rounds, and keeps the target within the set's span", () => {
    expect(ratingRangeFor(1523.6, "normal").ratingMin).toBe(1524 - AROUND_RATING_WINDOW);
    expect(ratingRangeFor(700, "easiest").ratingMin).toBe(600 - AROUND_RATING_WINDOW);
    expect(ratingRangeFor(2900, "hardest").ratingMax).toBe(3000 + AROUND_RATING_WINDOW);
    expect(ratingRangeFor(Number.NaN, "normal").ratingMin).toBe(1500 - AROUND_RATING_WINDOW);
  });

  it("knows its difficulties", () => {
    expect(isPuzzleDifficulty("harder")).toBe(true);
    expect(isPuzzleDifficulty("insane")).toBe(false);
  });
});
