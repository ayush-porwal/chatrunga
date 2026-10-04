import { describe, expect, it } from "vitest";
import { evalShare, liveAnalysisEval } from "./EvalBar";

describe("evalShare", () => {
  it("is even at 0 and grows with White's advantage", () => {
    expect(evalShare({ type: "cp", value: 0 })).toBe(50);
    expect(evalShare({ type: "cp", value: 100 })).toBeGreaterThan(55);
    expect(evalShare({ type: "cp", value: 100 })).toBeLessThan(62);
    expect(evalShare({ type: "cp", value: -300 })).toBeLessThan(30);
    expect(evalShare({ type: "cp", value: 1000 })).toBeGreaterThan(95);
  });

  it("fills the bar for a forced mate", () => {
    expect(evalShare({ type: "mate", value: 3 })).toBe(100);
    expect(evalShare({ type: "mate", value: -2 })).toBe(0);
  });
});

describe("liveAnalysisEval", () => {
  const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

  it("reads the side to move's score from White's side", () => {
    // Black to move and 0.5 better for Black: White is half a pawn worse.
    expect(liveAnalysisEval(AFTER_E4, { type: "cp", value: 50 })).toEqual({
      whiteShare: evalShare({ type: "cp", value: -50 }),
      label: "-0.5"
    });
  });

  it("has nothing to show before a score arrives", () => {
    expect(liveAnalysisEval(AFTER_E4, null)).toBeNull();
  });

  it("shows a finished position's result instead of a score", () => {
    const mated = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";
    expect(liveAnalysisEval(mated, { type: "cp", value: 300 })).toEqual({ whiteShare: 0, label: "0-1 #" });
    const stalemate = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1";
    expect(liveAnalysisEval(stalemate, null)).toEqual({ whiteShare: 50, label: "½-½" });
  });
});
