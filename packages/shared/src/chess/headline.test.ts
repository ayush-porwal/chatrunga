import { describe, expect, it } from "vitest";
import { renderHeadline } from "./headline";
import { buildRatingCurve } from "./rating-curve";

function curve(opts: {
  playedProb: [number, number, number, number, number];
  bestProb: [number, number, number, number, number];
  playedIsBest: boolean;
  userBucket: 1100 | 1300 | 1500 | 1700 | 1900;
}) {
  return buildRatingCurve(opts);
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
      "Maia assigns this move 55% weight in the lower buckets, even though the engine dislikes it."
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
    expect(renderHeadline(c)).toBe("The lower-rated Maia models frequently select this move.");
  });

  it("renders rating_cliff with the cliffRating bucket - 200", () => {
    const c = curve({
      playedProb: [0.62, 0.55, 0.45, 0.18, 0.04],
      bestProb: [0.1, 0.2, 0.35, 0.55, 0.7],
      playedIsBest: false,
      userBucket: 1500
    });
    // cliffRating = 1700 → headline says "above 1500" (= 1700 - 200)
    expect(renderHeadline(c)).toBe("Maia estimates drop sharply above 1500.");
  });

  it("renders only_master_finds with locked copy", () => {
    const c = curve({
      playedProb: [0.18, 0.2, 0.22, 0.2, 0.1],
      bestProb: [0.15, 0.2, 0.3, 0.45, 0.78],
      playedIsBest: false,
      userBucket: 1500
    });
    expect(renderHeadline(c)).toBe("Difficult — the lower-rated Maia models rarely select this.");
  });

  it("renders your_level_blindspot with the user's bucket %", () => {
    const c = curve({
      playedProb: [0.45, 0.5, 0.55, 0.4, 0.35],
      bestProb: [0.1, 0.15, 0.18, 0.22, 0.28],
      playedIsBest: false,
      userBucket: 1500
    });
    expect(renderHeadline(c)).toBe(
      "Maia assigns this move 55% weight at your level, despite the engine's concern."
    );
  });

  it("renders found_what_your_level_misses with the user's bucket value", () => {
    const c = curve({
      playedProb: [0.04, 0.12, 0.25, 0.45, 0.72],
      bestProb: [0.04, 0.12, 0.25, 0.45, 0.72],
      playedIsBest: true,
      userBucket: 1300
    });
    expect(renderHeadline(c)).toBe(
      "Strong engine choice — lower-rated Maia models rarely select it."
    );
  });

  it("renders opening_principle with locked copy", () => {
    const c = curve({
      playedProb: [0.75, 0.78, 0.82, 0.85, 0.88],
      bestProb: [0.75, 0.78, 0.82, 0.85, 0.88],
      playedIsBest: true,
      userBucket: 1500
    });
    expect(renderHeadline(c)).toBe("Standard idea — the models agree on this continuation.");
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
      "Maia assigns this move 55% weight at your level, despite the engine's concern."
    );
  });
});
