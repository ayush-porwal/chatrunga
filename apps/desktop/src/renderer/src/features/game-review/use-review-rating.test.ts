import { describe, expect, it } from "vitest";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import { reviewMaiaModels, reviewRatingLabel } from "./use-review-rating";

const maia = (rating: 1100 | 1300 | 1500 | 1700 | 1900, isAvailable = true): EngineConfig => ({
  id: `maia-${rating}`,
  name: `Maia ${rating}`,
  executablePath: "/engines/lc0",
  workingDirectory: null,
  weightsPath: `/engines/maia-${rating}.pb.gz`,
  imagePath: null,
  args: [],
  protocol: "uci",
  runtime: "custom-uci",
  isAvailable,
  isDefault: false,
  isHumanPrediction: true,
  maiaRating: rating,
  createdAt: 0,
  updatedAt: 0
});

describe("reviewMaiaModels", () => {
  const engines = [maia(1100), maia(1500), maia(1900, false)];

  it("lists the installed levels a review runs", () => {
    expect(reviewMaiaModels(engines, { reviewUseMaia: true, reviewMaiaLevels: null })).toEqual([
      1100, 1500
    ]);
    expect(
      reviewMaiaModels(engines, { reviewUseMaia: true, reviewMaiaLevels: [1500, 1700] })
    ).toEqual([1500]);
  });

  it("has none with Maia off", () => {
    expect(reviewMaiaModels(engines, { reviewUseMaia: false, reviewMaiaLevels: null })).toEqual([]);
  });
});

describe("reviewRatingLabel", () => {
  it("says where the rating came from, and the Maia model it rounds to", () => {
    expect(
      reviewRatingLabel({ rating: 1533, source: "game", mode: "blitz", maiaModel: 1500 })
    ).toBe("1533 · from the game → Maia 1500");
    expect(
      reviewRatingLabel({ rating: 1000, source: "settings", mode: "rapid", maiaModel: 1100 })
    ).toBe("Rapid 1000 · from Settings → Maia 1100");
    expect(
      reviewRatingLabel({ rating: 1500, source: "settings", mode: "classical", maiaModel: 1500 })
    ).toBe("Classical 1500 · from Settings");
    expect(
      reviewRatingLabel({ rating: 1640, source: "game", mode: "rapid", maiaModel: null })
    ).toBe("1640 · from the game");
  });
});
