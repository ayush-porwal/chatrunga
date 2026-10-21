import { describe, expect, it } from "vitest";
import { reviewRatingLabel, sideRatingsLabel } from "./use-review-rating";

describe("reviewRatingLabel", () => {
  it("says where the rating came from", () => {
    expect(
      reviewRatingLabel({ rating: 1533, source: "game", mode: "blitz", maiaModel: 1500 })
    ).toBe("1533 · from the game");
    expect(
      reviewRatingLabel({ rating: 1000, source: "settings", mode: "rapid", maiaModel: 1100 })
    ).toBe("Rapid 1000 · from Settings");
  });
});

describe("sideRatingsLabel", () => {
  it("names the Review-settings rating once for both sides", () => {
    expect(
      sideRatingsLabel({
        white: { rating: 1800, source: "override" },
        black: { rating: 1800, source: "override" }
      })
    ).toBe("Both sides 1800");
  });

  it("names each side's rating and their shared source", () => {
    expect(
      sideRatingsLabel({
        white: { rating: 1500, source: "game" },
        black: { rating: 1700, source: "game" }
      })
    ).toBe("White 1500 · Black 1700 · from the game");
  });

  it("names each side's source when they differ", () => {
    expect(
      sideRatingsLabel({
        white: { rating: 2100, source: "game" },
        black: { rating: 1500, source: "settings" }
      })
    ).toBe("White 2100 (the game) · Black 1500 (Settings)");
  });
});
