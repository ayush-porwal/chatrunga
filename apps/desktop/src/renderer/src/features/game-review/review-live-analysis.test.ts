import { describe, expect, it } from "vitest";
import { reviewAnalysisMode } from "./review-live-analysis";

describe("reviewAnalysisMode", () => {
  const base = { on: true, running: false, desktop: true, mode: "freeplay" as const };

  it("starts live analysis when the switch is on", () => {
    expect(reviewAnalysisMode(base)).toBe("analysis");
    // Already analysing: nothing to change.
    expect(reviewAnalysisMode({ ...base, mode: "analysis" })).toBeNull();
  });

  it("stops it when the switch is off", () => {
    expect(reviewAnalysisMode({ ...base, on: false, mode: "analysis" })).toBe("freeplay");
    expect(reviewAnalysisMode({ ...base, on: false })).toBeNull();
  });

  it("pauses it while a review runs, and without the desktop engine", () => {
    expect(reviewAnalysisMode({ ...base, running: true, mode: "analysis" })).toBe("freeplay");
    expect(reviewAnalysisMode({ ...base, running: true })).toBeNull();
    expect(reviewAnalysisMode({ ...base, desktop: false })).toBeNull();
  });
});
