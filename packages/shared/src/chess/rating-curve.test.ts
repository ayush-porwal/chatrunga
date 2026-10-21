import { describe, expect, it } from "vitest";
import { MAIA_BUCKETS } from "../schemas/constants";
import { MAIA3_RATINGS } from "../engine/maia3";
import {
  interpretRatingCurve,
  buildRatingCurve,
  nearestRating,
  probFor,
  type InterpretInput
} from "./rating-curve";

/** A Maia 1 review's five-level curve (1100-1900): these results are locked from before Maia 3. */
function legacy(input: Omit<InterpretInput, "ratings">): InterpretInput {
  return { ratings: MAIA_BUCKETS, ...input };
}

/**
 * A Maia 3 curve over its 21 ratings (600-2600) from a function of the rating, rounded like the
 * saved predictions.
 */
function maia3(
  played: (rating: number) => number,
  best: (rating: number) => number,
  rest: Pick<InterpretInput, "playedIsBest" | "userRating">
): InterpretInput {
  const round = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 1e4) / 1e4;
  return {
    ratings: MAIA3_RATINGS,
    playedProb: MAIA3_RATINGS.map((rating) => round(played(rating))),
    bestProb: MAIA3_RATINGS.map((rating) => round(best(rating))),
    ...rest
  };
}

describe("interpretRatingCurve", () => {
  it("classifies opening_principle when bestProb is saturated at every rating", () => {
    const result = interpretRatingCurve(
      legacy({
        playedProb: [0.05, 0.05, 0.05, 0.05, 0.05],
        bestProb: [0.78, 0.82, 0.85, 0.88, 0.91],
        playedIsBest: false,
        userRating: 1500
      })
    );
    expect(result.label).toBe("opening_principle");
  });

  it("classifies trap_at_low_rating when playedProb is high at 1100/1300 and low at 1700/1900", () => {
    const result = interpretRatingCurve(
      legacy({
        playedProb: [0.78, 0.62, 0.31, 0.12, 0.04],
        bestProb: [0.08, 0.18, 0.41, 0.72, 0.89],
        playedIsBest: false,
        userRating: 1500
      })
    );
    expect(result.label).toBe("trap_at_low_rating");
  });

  it("classifies found_what_your_level_misses when played==best and rare at user level", () => {
    const result = interpretRatingCurve(
      legacy({
        playedProb: [0.04, 0.12, 0.25, 0.45, 0.72],
        bestProb: [0.04, 0.12, 0.25, 0.45, 0.72],
        playedIsBest: true,
        userRating: 1300
      })
    );
    expect(result.label).toBe("found_what_your_level_misses");
  });

  it("classifies rating_cliff and reports the crossover bucket", () => {
    // playedProb crosses below 0.30 between bucket 1500 (0.45) and 1700 (0.18)
    const result = interpretRatingCurve(
      legacy({
        playedProb: [0.62, 0.55, 0.45, 0.18, 0.04],
        bestProb: [0.1, 0.2, 0.35, 0.55, 0.7],
        playedIsBest: false,
        userRating: 1500
      })
    );
    expect(result.label).toBe("rating_cliff");
    expect(result.cliffRating).toBe(1700);
  });

  it("classifies only_master_finds when bestProb saturates only at 1900", () => {
    const result = interpretRatingCurve(
      legacy({
        playedProb: [0.18, 0.2, 0.22, 0.2, 0.1],
        bestProb: [0.15, 0.2, 0.3, 0.45, 0.78],
        playedIsBest: false,
        userRating: 1500
      })
    );
    expect(result.label).toBe("only_master_finds");
  });

  it("classifies your_level_blindspot when half of user's level plays this mistake", () => {
    const result = interpretRatingCurve(
      legacy({
        // Stable across ratings, not a trap pattern, no cliff. Half of 1500 plays this.
        playedProb: [0.45, 0.5, 0.55, 0.4, 0.35],
        bestProb: [0.1, 0.15, 0.18, 0.22, 0.28],
        playedIsBest: false,
        userRating: 1500
      })
    );
    expect(result.label).toBe("your_level_blindspot");
  });

  it("falls back to neutral when no signal qualifies", () => {
    const result = interpretRatingCurve(
      legacy({
        playedProb: [0.2, 0.22, 0.23, 0.2, 0.18],
        bestProb: [0.25, 0.28, 0.3, 0.32, 0.35],
        playedIsBest: false,
        userRating: 1500
      })
    );
    expect(result.label).toBe("neutral");
  });

  it("prefers opening_principle over found_what_your_level_misses when both qualify", () => {
    // If the right move is universally found AND the player played it: opening_principle
    // wins because it carries more information ("everyone finds this" > "you found this").
    const result = interpretRatingCurve(
      legacy({
        playedProb: [0.75, 0.78, 0.82, 0.85, 0.88],
        bestProb: [0.75, 0.78, 0.82, 0.85, 0.88],
        playedIsBest: true,
        userRating: 1500
      })
    );
    expect(result.label).toBe("opening_principle");
  });
});

describe("buildRatingCurve", () => {
  it("assembles a schema-shaped RatingCurve, keeping the probabilities exactly", () => {
    const played = [0.78, 0.62, 0.31, 0.12, 0.04] as const;
    const best = [0.08, 0.18, 0.41, 0.72, 0.89] as const;
    const curve = buildRatingCurve(
      legacy({
        playedProb: played,
        bestProb: best,
        playedIsBest: false,
        userRating: 1500
      })
    );
    expect(curve.ratings).toStrictEqual([1100, 1300, 1500, 1700, 1900]);
    expect(curve.playedProb).toStrictEqual(played);
    expect(curve.bestProb).toStrictEqual(best);
    expect(curve.userRatingBucket).toBe(1500);
    expect(curve.interpretation.label).toBe("trap_at_low_rating");
  });
});

describe("probFor", () => {
  const curve = buildRatingCurve(
    legacy({
      playedProb: [0.78, 0.62, 0.31, 0.12, 0.04],
      bestProb: [0.08, 0.18, 0.41, 0.72, 0.89],
      playedIsBest: false,
      userRating: 1500
    })
  );

  it("returns the played or best probability for the requested bucket", () => {
    expect(probFor(curve, 1100, "played")).toBeCloseTo(0.78);
    expect(probFor(curve, 1500, "played")).toBeCloseTo(0.31);
    expect(probFor(curve, 1900, "played")).toBeCloseTo(0.04);
    expect(probFor(curve, 1100, "best")).toBeCloseTo(0.08);
    expect(probFor(curve, 1700, "best")).toBeCloseTo(0.72);
  });
});

/** 600-2600: likely at 1000, unlikely 1100-1900, likely again from 2000. */
const BEST_DIPPING = [
  ...Array<number>(4).fill(0.2),
  0.4,
  ...Array<number>(9).fill(0.2),
  ...Array<number>(7).fill(0.4)
];

describe("Maia 3's 21-point curves", () => {
  it("reads the low and high ends from the curve's own ratings", () => {
    // Played by most players up to 1000, by almost nobody from 1800.
    const curve = buildRatingCurve(
      maia3(
        (rating) => Math.min(0.8, 1.8 - rating / 1000),
        (rating) => rating / 3000,
        { playedIsBest: false, userRating: 1500 }
      )
    );
    expect(curve.ratings).toHaveLength(21);
    expect(curve.interpretation).toStrictEqual({ label: "trap_at_low_rating" });
    // The best move reaches 30% at 900 and keeps climbing.
    expect(curve.bestLikelyFrom).toBe(900);
  });

  it("names the first rating below the cliff from the data", () => {
    const curve = buildRatingCurve(
      maia3(
        (rating) => 0.6 - (rating - 600) * 0.0002,
        () => 0.2,
        { playedIsBest: false, userRating: 1500 }
      )
    );
    expect(curve.interpretation).toStrictEqual({ label: "rating_cliff", cliffRating: 2200 });
    expect(curve.bestLikelyFrom).toBeUndefined();
  });

  it("reads the player's level at the curve's nearest rating", () => {
    const input = maia3(
      (rating) => rating / 5000,
      (rating) => rating / 5000,
      { playedIsBest: true, userRating: 1450 }
    );
    const curve = buildRatingCurve(input);
    expect(curve.userRatingBucket).toBe(1400);
    expect(curve.interpretation.label).toBe("found_what_your_level_misses");
    expect(curve.bestLikelyFrom).toBe(1500);
    expect(probFor(curve, 1400, "played")).toBeCloseTo(0.28);
    expect(probFor(curve, 1450, "played")).toBe(0);
    // At 1600 the move is a common one: no longer a find.
    expect(interpretRatingCurve({ ...input, userRating: 1600 }).label).toBe("neutral");
  });

  it("only counts the best move as likely from where it stays likely", () => {
    const curve = buildRatingCurve(
      maia3(
        () => 0.1,
        // 40% at 1000 only, then again from 2000.
        (rating) => BEST_DIPPING[(rating - 600) / 100],
        { playedIsBest: false, userRating: 1500 }
      )
    );
    expect(curve.bestLikelyFrom).toBe(2000);
  });

  it("reads a curve without enough aligned points as neutral", () => {
    expect(
      interpretRatingCurve({
        ratings: [1500],
        playedProb: [0.9],
        bestProb: [0.9],
        playedIsBest: false,
        userRating: 1500
      })
    ).toStrictEqual({ label: "neutral" });
    expect(
      interpretRatingCurve({
        ratings: [1500, 1600],
        playedProb: [0.9],
        bestProb: [0.9, 0.9],
        playedIsBest: false,
        userRating: 1500
      })
    ).toStrictEqual({ label: "neutral" });
  });
});

describe("nearestRating", () => {
  it("picks the nearest of any ratings, ties toward the lower one", () => {
    expect(nearestRating(MAIA3_RATINGS, 1449)).toBe(1400);
    expect(nearestRating(MAIA3_RATINGS, 1450)).toBe(1400);
    expect(nearestRating(MAIA3_RATINGS, 3000)).toBe(2600);
    expect(nearestRating(MAIA_BUCKETS, 1200)).toBe(1100);
    expect(nearestRating([], 1234)).toBe(1234);
  });
});
