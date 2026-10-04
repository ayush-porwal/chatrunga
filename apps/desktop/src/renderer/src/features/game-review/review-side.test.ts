import { describe, expect, it } from "vitest";
import { resolveReviewSide, sideNamed, type ReviewSideInput } from "./review-side";

const imported: ReviewSideInput = {
  chosen: null,
  reviewSide: null,
  hasReview: false,
  source: "pgn-import",
  headers: { white: "Alpha", black: "Beta" },
  lichessUsername: null,
  engineSide: null,
  fallback: "white"
};

describe("resolveReviewSide", () => {
  it("knows the user's side in an engine game and a Lichess game", () => {
    expect(
      resolveReviewSide({
        ...imported,
        source: "engine-game",
        headers: { white: "Stockfish", black: "You" }
      })
    ).toEqual({ status: "known", side: "black" });
    expect(resolveReviewSide({ ...imported, source: "engine-game", engineSide: "black" })).toEqual({
      status: "known",
      side: "white"
    });
    expect(resolveReviewSide({ ...imported, source: "lichess", lichessUsername: "beta" })).toEqual({
      status: "known",
      side: "black"
    });
  });

  it("asks before an imported game's first review, preselecting the Lichess account's side", () => {
    expect(resolveReviewSide({ ...imported, lichessUsername: "BETA" })).toEqual({
      status: "ask",
      preselect: "black"
    });
    // No name matches: the Settings side.
    expect(resolveReviewSide({ ...imported, fallback: "black" })).toEqual({
      status: "ask",
      preselect: "black"
    });
  });

  it("remembers the side: the one picked, then the one saved with the review", () => {
    expect(resolveReviewSide({ ...imported, chosen: "black" })).toEqual({
      status: "known",
      side: "black"
    });
    expect(resolveReviewSide({ ...imported, reviewSide: "black", hasReview: true })).toEqual({
      status: "known",
      side: "black"
    });
    // Switching sides in the settings wins over the saved review's side.
    expect(
      resolveReviewSide({ ...imported, chosen: "white", reviewSide: "black", hasReview: true })
    ).toEqual({ status: "known", side: "white" });
    // A review from before Review as never asks again: the Settings side.
    expect(resolveReviewSide({ ...imported, hasReview: true, fallback: "black" })).toEqual({
      status: "known",
      side: "black"
    });
  });

  it("matches only one side's name", () => {
    expect(sideNamed({ white: "same", black: "same" }, "same")).toBeNull();
    expect(sideNamed({ white: " Alpha ", black: "Beta" }, "alpha")).toBe("white");
    expect(sideNamed({ white: "Alpha", black: "Beta" }, null)).toBeNull();
  });
});
