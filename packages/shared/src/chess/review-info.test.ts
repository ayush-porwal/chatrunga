import { describe, expect, it } from "vitest";
import type { GameReview } from "../types/engine";
import {
  reviewInfoBrief,
  reviewInfoDetails,
  reviewInfoLabel,
  reviewInfoWhen,
  savedReviewInfo
} from "./review-info";

const review = {
  engineId: "sf",
  engineName: " Stockfish 17 ",
  depth: null,
  moveTimeMs: 1000,
  createdAt: Date.UTC(2026, 9, 2, 18, 15),
  summary: {},
  moves: [{}, {}],
  maiaEngines: [
    { rating: 1900, engineId: "a", name: "" },
    { rating: 1100, engineId: "b", name: "" }
  ],
  commentary: [{ ply: 1, prose: "", generatedAt: 0 }]
} as unknown as GameReview;

describe("review info", () => {
  it("lists an analysis by its engine, search, Maia levels and comments", () => {
    const info = savedReviewInfo(review, "r1");
    expect(info).toMatchObject({
      reviewId: "r1",
      engineId: "sf",
      engineName: "Stockfish 17",
      moveTimeMs: 1000,
      maiaLevels: [1100, 1900],
      maiaModel: "maia1",
      moveCount: 2,
      commentaryCount: 1
    });
    expect(reviewInfoLabel(info, "en-US")).toMatch(
      /^Oct 2, .* · Stockfish 17 · 1 s\/move · Maia 1100–1900 · 1 AI comment$/
    );
    // In brief (a list row), only the engine and its search.
    expect(reviewInfoBrief(info)).toBe("Stockfish 17 · 1 s/move");
    // The time reads like a clock, without a leading zero: `Oct 4, 4:01 PM`.
    expect(
      reviewInfoWhen({ ...info, createdAt: new Date(2026, 9, 4, 16, 1).getTime() }, "en-US")
    ).toBe("Oct 4, 4:01 PM");
    expect(
      reviewInfoLabel(
        {
          ...info,
          moveTimeMs: null,
          depth: 18,
          maiaLevels: [],
          commentaryCount: 0,
          engineName: null
        },
        "en-US"
      )
    ).toMatch(/ · Engine · depth 18$/);
  });

  it("doesn't trust stored fields, and counts only the comments the app shows", () => {
    const odd = {
      ...review,
      engineId: 7,
      engineName: 1,
      moveTimeMs: "fast",
      maiaEngines: [{ rating: "x" }, { rating: 1500 }],
      commentary: [
        { ply: 1, prose: "AI", generatedAt: 0, providerModel: "m" },
        { ply: 2, prose: "template", generatedAt: 0, fallback: true },
        { ply: 3, prose: "template", generatedAt: 0, source: "local-fallback" }
      ]
    } as unknown as GameReview;
    expect(savedReviewInfo(odd, "r")).toMatchObject({
      engineId: null,
      engineName: null,
      moveTimeMs: null,
      maiaLevels: [1500],
      commentaryCount: 1
    });
  });

  it("says which Maia read the moves: Maia 3 when the review records it, else Maia 1's engines", () => {
    const side = { rating: 1500, source: "game" };
    const maia3 = {
      ...review,
      maiaEngines: undefined,
      maia: { model: "maia3", modelVersion: "v", white: side, black: side }
    } as unknown as GameReview;
    expect(savedReviewInfo(maia3, "r").maiaModel).toBe("maia3");
    const none = { ...review, maiaEngines: [], maia: "maia3" } as unknown as GameReview;
    expect(savedReviewInfo(none, "r")).not.toHaveProperty("maiaModel");
  });

  it("labels a Maia 3 analysis with each side's rating, a Maia 1 one with its levels", () => {
    const maia3 = (white: unknown, black: unknown) =>
      reviewInfoDetails(
        savedReviewInfo(
          {
            ...review,
            maiaEngines: undefined,
            commentary: [],
            maia: { model: "maia3", modelVersion: "v", white, black }
          } as unknown as GameReview,
          "r"
        )
      );
    expect(maia3({ rating: 1500, source: "game" }, { rating: 1600, source: "game" })).toBe(
      "Stockfish 17 · 1 s/move · Maia 3 · 1500/1600"
    );
    expect(maia3({ rating: 1800, source: "override" }, { rating: 1800, source: "override" })).toBe(
      "Stockfish 17 · 1 s/move · Maia 3 · 1800"
    );
    // Ratings that can't be read: the model alone.
    expect(maia3({ rating: "x" }, null)).toBe("Stockfish 17 · 1 s/move · Maia 3");
    expect(reviewInfoDetails(savedReviewInfo({ ...review, commentary: [] }, "r"))).toBe(
      "Stockfish 17 · 1 s/move · Maia 1100–1900"
    );
  });
});
