import { describe, expect, it } from "vitest";
import { renderHeadline } from "./headline";
import { MAIA3_RATINGS } from "../engine/maia3";
import { MAIA_BUCKETS } from "../schemas/constants";
import { buildRatingCurve } from "./rating-curve";

/** A Maia 1 review's five-level curve (1100-1900). */
function curve(opts: {
  playedProb: [number, number, number, number, number];
  bestProb: [number, number, number, number, number];
  playedIsBest: boolean;
  userBucket: 1100 | 1300 | 1500 | 1700 | 1900;
}) {
  const { userBucket, ...rest } = opts;
  return buildRatingCurve({ ratings: MAIA_BUCKETS, userRating: userBucket, ...rest });
}

/** A Maia 3 curve over its 21 ratings (600-2600) from a function of the rating. */
function maia3Curve(
  played: (rating: number) => number,
  best: (rating: number) => number,
  opts: { playedIsBest: boolean; userRating: number }
) {
  return buildRatingCurve({
    ratings: MAIA3_RATINGS,
    playedProb: MAIA3_RATINGS.map(played),
    bestProb: MAIA3_RATINGS.map(best),
    ...opts
  });
}

describe("renderHeadline", () => {
  it("renders the trap headline with specific % when user is squarely in the trap", () => {
    const c = curve({
      playedProb: [0.78, 0.62, 0.55, 0.12, 0.04],
      bestProb: [0.08, 0.18, 0.3, 0.72, 0.89],
      playedIsBest: false,
      userBucket: 1500
    });
    // playedProb[1500] = 0.55 → in the 0.40-0.70 zone → specific variant
    expect(renderHeadline(c)).toBe(
      "Maia assigns this move 55% weight at 1500, even though the engine dislikes it."
    );
  });

  it("renders the generic trap headline when player is outside the trap zone", () => {
    const c = curve({
      playedProb: [0.78, 0.62, 0.31, 0.12, 0.04],
      bestProb: [0.08, 0.18, 0.41, 0.72, 0.89],
      playedIsBest: false,
      userBucket: 1500
    });
    // playedProb[1500] = 0.31 → below 0.40 → generic variant
    expect(renderHeadline(c)).toBe("Maia frequently selects this move at lower ratings.");
  });

  it("renders rating_cliff with the rating before the cliff", () => {
    const c = curve({
      playedProb: [0.62, 0.55, 0.45, 0.18, 0.04],
      bestProb: [0.1, 0.2, 0.35, 0.55, 0.7],
      playedIsBest: false,
      userBucket: 1500
    });
    // cliffRating = 1700 → headline says "above 1500" (the level before it)
    expect(renderHeadline(c)).toBe("Maia estimates drop sharply above 1500.");
  });

  it("renders only_master_finds with locked copy", () => {
    const c = curve({
      playedProb: [0.18, 0.2, 0.22, 0.2, 0.1],
      bestProb: [0.15, 0.2, 0.3, 0.45, 0.78],
      playedIsBest: false,
      userBucket: 1500
    });
    expect(renderHeadline(c)).toBe("Difficult — Maia rarely selects this at lower ratings.");
  });

  it("renders your_level_blindspot with the user's bucket %", () => {
    const c = curve({
      playedProb: [0.45, 0.5, 0.55, 0.4, 0.35],
      bestProb: [0.1, 0.15, 0.18, 0.22, 0.28],
      playedIsBest: false,
      userBucket: 1500
    });
    expect(renderHeadline(c)).toBe(
      "Maia assigns this move 55% weight at 1500, despite the engine's concern."
    );
  });

  it("renders found_what_your_level_misses with the user's bucket value", () => {
    const c = curve({
      playedProb: [0.04, 0.12, 0.25, 0.45, 0.72],
      bestProb: [0.04, 0.12, 0.25, 0.45, 0.72],
      playedIsBest: true,
      userBucket: 1300
    });
    expect(renderHeadline(c)).toBe("Strong engine choice — Maia rarely selects it at 1300.");
  });

  it("renders opening_principle with locked copy", () => {
    const c = curve({
      playedProb: [0.75, 0.78, 0.82, 0.85, 0.88],
      bestProb: [0.75, 0.78, 0.82, 0.85, 0.88],
      playedIsBest: true,
      userBucket: 1500
    });
    expect(renderHeadline(c)).toBe("Standard idea — Maia expects it at every rating.");
  });

  it("returns null for neutral label so the panel omits the headline", () => {
    const c = curve({
      playedProb: [0.2, 0.22, 0.23, 0.2, 0.18],
      bestProb: [0.25, 0.28, 0.3, 0.32, 0.35],
      playedIsBest: false,
      userBucket: 1500
    });
    expect(renderHeadline(c)).toBeNull();
  });

  it("rounds percentages to nearest 5", () => {
    const c = curve({
      // 0.475 -> rounds to 50%
      playedProb: [0.475, 0.5, 0.525, 0.5, 0.48],
      bestProb: [0.1, 0.1, 0.1, 0.1, 0.1],
      playedIsBest: false,
      userBucket: 1500
    });
    expect(renderHeadline(c)).toBe(
      "Maia assigns this move 55% weight at 1500, despite the engine's concern."
    );
  });

  it("names Maia 3's ratings from the curve", () => {
    const cliff = maia3Curve(
      (rating) => 0.6 - (rating - 600) * 0.0002,
      () => 0.2,
      { playedIsBest: false, userRating: 1500 }
    );
    expect(renderHeadline(cliff)).toBe("Maia estimates drop sharply above 2100.");
    const find = maia3Curve(
      (rating) => rating / 5000,
      (rating) => rating / 5000,
      { playedIsBest: true, userRating: 1400 }
    );
    expect(renderHeadline(find)).toBe("Strong engine choice — Maia rarely selects it at 1400.");
  });
});
