import { describe, expect, it } from "vitest";
import {
  DEFAULT_REVIEW_MOVETIME_MS,
  resolveReviewSearchParams,
  reviewAnalysisTimeoutMs
} from "./review-search";

describe("resolveReviewSearchParams", () => {
  it("defaults to movetime when depth and moveTime are absent", () => {
    const r = resolveReviewSearchParams({});
    expect(r.moveTimeMs).toBe(DEFAULT_REVIEW_MOVETIME_MS);
    expect(r.recordMoveTimeMs).toBe(DEFAULT_REVIEW_MOVETIME_MS);
    expect(r.recordDepth).toBe(null);
    expect(r.moveTimeMs).not.toBeNull();
  });

  it("uses depth-only when depth is positive and moveTime unset", () => {
    const r = resolveReviewSearchParams({ depth: 12 });
    expect(r.moveTimeMs).toBe(null);
    expect(r.depth).toBe(12);
    expect(r.recordDepth).toBe(12);
    expect(r.recordMoveTimeMs).toBe(null);
  });

  it("prefers movetime when both are set", () => {
    const r = resolveReviewSearchParams({ depth: 18, moveTimeMs: 3000 });
    expect(r.moveTimeMs).toBe(3000);
    expect(r.recordMoveTimeMs).toBe(3000);
    expect(r.recordDepth).toBe(null);
  });
});

describe("reviewAnalysisTimeoutMs", () => {
  it("allows long budgets for depth × MultiPV (NN engines)", () => {
    const ms = reviewAnalysisTimeoutMs({ moveTimeMs: null, depth: 14, multipv: 3 });
    expect(ms).toBeGreaterThan(600_000);
  });

  it("scales with movetime and multipv", () => {
    const ms = reviewAnalysisTimeoutMs({ moveTimeMs: 5000, depth: 14, multipv: 3 });
    expect(ms).toBeGreaterThanOrEqual(90_000);
  });
});
