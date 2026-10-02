import { describe, expect, it } from "vitest";
import type { GameReview } from "../types/engine";
import { reviewInfoLabel, savedReviewInfo } from "./review-info";

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
    expect(info).toMatchObject({ reviewId: "r1", engineName: "Stockfish 17", moveTimeMs: 1000, maiaLevels: [1100, 1900], moveCount: 2, commentaryCount: 1 });
    expect(reviewInfoLabel(info, "en-US")).toMatch(/^Oct 2, .* · Stockfish 17 · 1 s\/move · Maia 1100–1900 · 1 AI comment$/);
    expect(reviewInfoLabel({ ...info, moveTimeMs: null, depth: 18, maiaLevels: [], commentaryCount: 0, engineName: null }, "en-US")).toMatch(
      / · Engine · depth 18$/
    );
  });
});
