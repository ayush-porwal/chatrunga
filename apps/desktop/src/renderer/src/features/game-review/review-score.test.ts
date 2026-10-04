import { describe, expect, it } from "vitest";
import { formatMoveEval, formatScore, terminalEvalLabel, whiteChartScore } from "./review-score";

const whiteToMove = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const blackToMove = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

describe("whiteChartScore", () => {
  it("plots checkmate as a win for the mover", () => {
    const mate = { type: "mate" as const, value: 0 };
    expect(
      whiteChartScore({ evalAfter: mate, fenBefore: whiteToMove, terminal: "checkmate" })
    ).toBe(1000);
    expect(
      whiteChartScore({ evalAfter: mate, fenBefore: blackToMove, terminal: "checkmate" })
    ).toBe(-1000);
  });

  it("keeps White-perspective mates and clamps centipawns", () => {
    expect(
      whiteChartScore({ evalAfter: { type: "mate", value: -3 }, fenBefore: whiteToMove })
    ).toBe(-1000);
    expect(
      whiteChartScore({ evalAfter: { type: "cp", value: 2400 }, fenBefore: blackToMove })
    ).toBe(1000);
    expect(whiteChartScore({ evalAfter: { type: "cp", value: -85 }, fenBefore: whiteToMove })).toBe(
      -85
    );
    expect(whiteChartScore({ evalAfter: null, fenBefore: whiteToMove })).toBe(0);
  });
});

describe("terminalEvalLabel", () => {
  it("names the result instead of M0", () => {
    const mate = { type: "mate" as const, value: 0 };
    expect(
      terminalEvalLabel({ evalAfter: mate, fenBefore: whiteToMove, terminal: "checkmate" })
    ).toBe("1-0 #");
    expect(
      terminalEvalLabel({ evalAfter: mate, fenBefore: blackToMove, terminal: "checkmate" })
    ).toBe("0-1 #");
    expect(
      terminalEvalLabel({
        evalAfter: { type: "cp", value: 0 },
        fenBefore: whiteToMove,
        terminal: "stalemate"
      })
    ).toBe("½-½");
    expect(
      terminalEvalLabel({
        evalAfter: { type: "cp", value: 30 },
        fenBefore: whiteToMove,
        terminal: null
      })
    ).toBeNull();
  });
});

describe("formatScore", () => {
  it("formats centipawns, mates and missing scores", () => {
    expect(formatScore({ type: "cp", value: 35 })).toBe("+0.3");
    expect(formatScore({ type: "cp", value: -120 })).toBe("-1.2");
    expect(formatScore({ type: "cp", value: 35 }, 2)).toBe("+0.35");
    expect(formatScore({ type: "cp", value: 0 })).toBe("0.0");
    expect(formatScore({ type: "mate", value: 3 })).toBe("M+3");
    expect(formatScore({ type: "mate", value: -2 })).toBe("M-2");
    expect(formatScore(null)).toBe("—");
  });
});

describe("formatMoveEval", () => {
  it("shows the result for a finished game and the score otherwise", () => {
    expect(
      formatMoveEval({
        evalAfter: { type: "mate", value: 0 },
        fenBefore: whiteToMove,
        terminal: "checkmate"
      })
    ).toBe("1-0 #");
    expect(
      formatMoveEval({
        evalAfter: { type: "cp", value: -45 },
        fenBefore: blackToMove,
        terminal: null
      })
    ).toBe("-0.5");
  });
});
