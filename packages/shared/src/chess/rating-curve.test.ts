import { describe, expect, it } from "vitest";
import { interpretRatingCurve, buildRatingCurve, probFor, quantizeToBucket } from "./rating-curve";

describe("interpretRatingCurve", () => {
  it("classifies opening_principle when bestProb is saturated at every rating", () => {
    const result = interpretRatingCurve({
      playedProb: [0.05, 0.05, 0.05, 0.05, 0.05],
      bestProb: [0.78, 0.82, 0.85, 0.88, 0.91],
      playedIsBest: false,
      userBucket: 1500
    });
    expect(result.label).toBe("opening_principle");
  });

  it("classifies trap_at_low_rating when playedProb is high at 1100/1300 and low at 1700/1900", () => {
    const result = interpretRatingCurve({
      playedProb: [0.78, 0.62, 0.31, 0.12, 0.04],
      bestProb: [0.08, 0.18, 0.41, 0.72, 0.89],
      playedIsBest: false,
      userBucket: 1500
    });
    expect(result.label).toBe("trap_at_low_rating");
  });

  it("classifies found_what_your_level_misses when played==best and rare at user level", () => {
    const result = interpretRatingCurve({
      playedProb: [0.04, 0.12, 0.25, 0.45, 0.72],
      bestProb: [0.04, 0.12, 0.25, 0.45, 0.72],
      playedIsBest: true,
      userBucket: 1300
    });
    expect(result.label).toBe("found_what_your_level_misses");
  });

  it("classifies rating_cliff and reports the crossover bucket", () => {
    // playedProb crosses below 0.30 between bucket 1500 (0.45) and 1700 (0.18)
    const result = interpretRatingCurve({
      playedProb: [0.62, 0.55, 0.45, 0.18, 0.04],
      bestProb: [0.1, 0.2, 0.35, 0.55, 0.7],
      playedIsBest: false,
      userBucket: 1500
    });
    expect(result.label).toBe("rating_cliff");
    expect(result.cliffRating).toBe(1700);
  });

  it("classifies only_master_finds when bestProb saturates only at 1900", () => {
    const result = interpretRatingCurve({
      playedProb: [0.18, 0.2, 0.22, 0.2, 0.1],
      bestProb: [0.15, 0.2, 0.3, 0.45, 0.78],
      playedIsBest: false,
      userBucket: 1500
    });
    expect(result.label).toBe("only_master_finds");
  });

  it("classifies your_level_blindspot when half of user's level plays this mistake", () => {
    const result = interpretRatingCurve({
      // Stable across ratings, not a trap pattern, no cliff. Half of 1500 plays this.
      playedProb: [0.45, 0.5, 0.55, 0.4, 0.35],
      bestProb: [0.1, 0.15, 0.18, 0.22, 0.28],
      playedIsBest: false,
      userBucket: 1500
    });
    expect(result.label).toBe("your_level_blindspot");
  });

  it("falls back to neutral when no signal qualifies", () => {
    const result = interpretRatingCurve({
      playedProb: [0.2, 0.22, 0.23, 0.2, 0.18],
      bestProb: [0.25, 0.28, 0.3, 0.32, 0.35],
      playedIsBest: false,
      userBucket: 1500
    });
    expect(result.label).toBe("neutral");
  });

  it("prefers opening_principle over found_what_your_level_misses when both qualify", () => {
    // If the right move is universally found AND the player played it: opening_principle
    // wins because it carries more information ("everyone finds this" > "you found this").
    const result = interpretRatingCurve({
      playedProb: [0.75, 0.78, 0.82, 0.85, 0.88],
      bestProb: [0.75, 0.78, 0.82, 0.85, 0.88],
      playedIsBest: true,
      userBucket: 1500
    });
    expect(result.label).toBe("opening_principle");
  });
});

describe("buildRatingCurve", () => {
  it("assembles a schema-shaped RatingCurve, keeping the probabilities exactly", () => {
    const played = [0.78, 0.62, 0.31, 0.12, 0.04] as const;
    const best = [0.08, 0.18, 0.41, 0.72, 0.89] as const;
    const curve = buildRatingCurve({
      playedProb: played,
      bestProb: best,
      playedIsBest: false,
      userBucket: 1500
    });
    expect(curve.ratings).toEqual([1100, 1300, 1500, 1700, 1900]);
    expect(curve.playedProb).toEqual(played);
    expect(curve.bestProb).toEqual(best);
    expect(curve.userRatingBucket).toBe(1500);
    expect(curve.interpretation.label).toBe("trap_at_low_rating");
  });
});

describe("probFor", () => {
  const curve = buildRatingCurve({
    playedProb: [0.78, 0.62, 0.31, 0.12, 0.04],
    bestProb: [0.08, 0.18, 0.41, 0.72, 0.89],
    playedIsBest: false,
    userBucket: 1500
  });

  it("returns the played or best probability for the requested bucket", () => {
    expect(probFor(curve, 1100, "played")).toBeCloseTo(0.78);
    expect(probFor(curve, 1500, "played")).toBeCloseTo(0.31);
    expect(probFor(curve, 1900, "played")).toBeCloseTo(0.04);
    expect(probFor(curve, 1100, "best")).toBeCloseTo(0.08);
    expect(probFor(curve, 1700, "best")).toBeCloseTo(0.72);
  });
});

describe("quantizeToBucket", () => {
  it("clamps ratings outside the Maia ladder to the end buckets", () => {
    expect(quantizeToBucket(400)).toBe(1100);
    expect(quantizeToBucket(2800)).toBe(1900);
  });

  it("picks the nearest bucket and breaks ties toward the lower one", () => {
    expect(quantizeToBucket(1290)).toBe(1300);
    expect(quantizeToBucket(1201)).toBe(1300);
    expect(quantizeToBucket(1200)).toBe(1100);
    expect(quantizeToBucket(1750)).toBe(1700);
  });
});
