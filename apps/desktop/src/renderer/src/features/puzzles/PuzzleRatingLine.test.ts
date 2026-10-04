import { describe, expect, it } from "vitest";
import { formatPuzzleRating, formatRatingDelta, ratingLine } from "./PuzzleRatingLine";

describe("puzzle rating text", () => {
  it("rounds the rating and marks a provisional one with ?", () => {
    expect(formatPuzzleRating({ rating: 1523.4, deviation: 80 })).toBe("1523");
    expect(formatPuzzleRating({ rating: 1736.6, deviation: 290 })).toBe("1737?");
  });

  it("signs the change", () => {
    expect(formatRatingDelta(12)).toBe("+12");
    expect(formatRatingDelta(-8)).toBe("−8");
    expect(formatRatingDelta(0)).toBe("±0");
  });

  it("says what the attempt did to the rating", () => {
    const after = { rating: 1523, deviation: 80, volatility: 0.09 };
    expect(
      ratingLine({
        attemptId: "a",
        rated: true,
        unratedReason: null,
        before: after,
        after,
        delta: 12
      })
    ).toEqual({
      text: "Your rating 1523",
      delta: 12
    });
    const unrated = { attemptId: "a", rated: false, before: null, after: null, delta: null };
    expect(ratingLine({ ...unrated, unratedReason: "unrated-puzzle" })).toEqual({
      text: "Unrated puzzle",
      delta: null
    });
    expect(ratingLine({ ...unrated, unratedReason: "already-played" })).toEqual({
      text: "Already played — not rated",
      delta: null
    });
  });
});
