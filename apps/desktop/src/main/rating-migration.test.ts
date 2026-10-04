import { describe, expect, it } from "vitest";
import { uniformRatings, type PlayerRatings } from "@chaturanga/shared/types/ratings";
import { migratePlayerRatings } from "./rating-migration";

function run(stored: { playerRatings?: unknown; reviewPlayerRating?: unknown }) {
  const written: PlayerRatings[] = [];
  const result = migratePlayerRatings({
    storedRatings: () => stored.playerRatings,
    legacyRating: () => stored.reviewPlayerRating,
    set: (ratings) => written.push(ratings)
  });
  return { result, written };
}

describe("migratePlayerRatings", () => {
  it("makes the old single rating every mode's typed-in rating", () => {
    expect(run({ reviewPlayerRating: 1840 })).toEqual({
      result: "migrated",
      written: [uniformRatings(1840)]
    });
    expect(run({ reviewPlayerRating: 1840 }).written[0]?.correspondence).toEqual({
      source: "manual",
      rating: 1840
    });
  });

  it("holds an out-of-range old rating to the range", () => {
    expect(run({ reviewPlayerRating: 9000 }).written).toEqual([uniformRatings(3500)]);
  });

  it("leaves ratings already stored alone (it runs once)", () => {
    const ratings = { ...uniformRatings(1500), blitz: { source: "manual", rating: 1720 } };
    expect(run({ playerRatings: ratings, reviewPlayerRating: 1840 })).toEqual({
      result: "unchanged",
      written: []
    });
  });

  it("keeps the defaults when no rating was ever stored, or it can't be read", () => {
    expect(run({})).toEqual({ result: "unchanged", written: [] });
    expect(run({ reviewPlayerRating: "strong" })).toEqual({ result: "unchanged", written: [] });
  });

  it("replaces damaged stored ratings from the old rating", () => {
    expect(run({ playerRatings: 1500, reviewPlayerRating: 1200 }).written).toEqual([
      uniformRatings(1200)
    ]);
  });
});
