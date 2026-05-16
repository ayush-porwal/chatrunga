import { describe, expect, it } from "vitest";
import {
  classifyMove,
  formatEngineScore,
  reviewLabel,
  scoreFromWhitePerspective,
  scoreToCentipawns
} from "./review";

describe("review helpers", () => {
  it("classifies missed tactics before generic mistakes", () => {
    expect(
      classifyMove({
        playedMove: "g1f3",
        bestMove: "d1h5",
        evalLoss: 180,
        hasMissedTactic: true
      })
    ).toBe("missed_tactic");
  });

  it("keeps exact engine matches as best moves", () => {
    expect(
      classifyMove({
        playedMove: "e2e4",
        bestMove: "e2e4",
        evalLoss: 30,
        hasMissedTactic: false
      })
    ).toBe("best");
  });

  it("converts scores into White perspective", () => {
    expect(scoreFromWhitePerspective({ type: "cp", value: 80 }, "white")).toEqual({
      type: "cp",
      value: 80
    });
    expect(scoreFromWhitePerspective({ type: "cp", value: 80 }, "black")).toEqual({
      type: "cp",
      value: -80
    });
  });

  it("formats centipawn and mate scores", () => {
    expect(formatEngineScore(null)).toBe("-");
    expect(formatEngineScore({ type: "cp", value: 126 })).toBe("+1.26");
    expect(formatEngineScore({ type: "mate", value: -3 })).toBe("M-3");
  });

  it("classifies each eval-loss bucket", () => {
    expect(classifyMove({ playedMove: "a", bestMove: null, evalLoss: null, hasMissedTactic: false })).toBe("good");
    expect(classifyMove({ playedMove: "a", bestMove: "b", evalLoss: 10, hasMissedTactic: false })).toBe("best");
    expect(classifyMove({ playedMove: "a", bestMove: "b", evalLoss: 25, hasMissedTactic: false })).toBe("excellent");
    expect(classifyMove({ playedMove: "a", bestMove: "b", evalLoss: 70, hasMissedTactic: false })).toBe("good");
    expect(classifyMove({ playedMove: "a", bestMove: "b", evalLoss: 120, hasMissedTactic: false })).toBe("inaccuracy");
    expect(classifyMove({ playedMove: "a", bestMove: "b", evalLoss: 250, hasMissedTactic: false })).toBe("mistake");
    expect(classifyMove({ playedMove: "a", bestMove: "b", evalLoss: 400, hasMissedTactic: false })).toBe("blunder");
  });

  it("labels review classifications", () => {
    expect(["best", "excellent", "good", "inaccuracy", "mistake", "blunder", "missed_tactic"].map((item) =>
      reviewLabel(item as Parameters<typeof reviewLabel>[0])
    )).toEqual(["Best", "Excellent", "Good", "Inaccuracy", "Mistake", "Blunder", "Missed tactic"]);
  });

  it("converts mate scores to large centipawn sentinels", () => {
    expect(scoreToCentipawns({ type: "cp", value: -12 })).toBe(-12);
    expect(scoreToCentipawns({ type: "mate", value: 0 })).toBe(100000);
    expect(scoreToCentipawns({ type: "mate", value: -2 })).toBe(-100000);
  });
});
