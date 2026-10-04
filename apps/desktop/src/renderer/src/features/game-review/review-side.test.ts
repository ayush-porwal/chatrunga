import { describe, expect, it } from "vitest";
import { openingPuzzleTag } from "./practice-puzzles";
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

describe("openingPuzzleTag", () => {
  const name = "Sicilian Defense: Najdorf Variation, English Attack";

  it("is the exact variation when the database has its puzzles", async () => {
    const asked: string[] = [];
    const tag = await openingPuzzleTag(name, async (candidate) => {
      asked.push(candidate);
      return true;
    });
    expect(tag).toBe("Sicilian_Defense_Najdorf_Variation");
    expect(asked).toEqual(["Sicilian_Defense_Najdorf_Variation"]);
  });

  it("falls back to the family when the variation has no puzzles", async () => {
    expect(await openingPuzzleTag(name, async () => false)).toBe("Sicilian_Defense");
  });

  it("keeps the variation when it can't be checked, and the family when there is no variation", async () => {
    expect(await openingPuzzleTag(name, async () => null)).toBe(
      "Sicilian_Defense_Najdorf_Variation"
    );
    expect(await openingPuzzleTag("Bird Opening", async () => false)).toBe("Bird_Opening");
  });
});
