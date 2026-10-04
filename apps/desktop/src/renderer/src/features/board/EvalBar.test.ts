import { describe, expect, it } from "vitest";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import {
  barScoreText,
  evalBarLabel,
  evalShare,
  liveAnalysisEval,
  reviewedMoveEval
} from "./EvalBar";

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
      label: "-0.5",
      barText: "0.5"
    });
  });

  it("has nothing to show before a score arrives", () => {
    expect(liveAnalysisEval(AFTER_E4, null)).toBeNull();
  });

  it("shows a finished position's result instead of a score", () => {
    const mated = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";
    expect(liveAnalysisEval(mated, { type: "cp", value: 300 })).toEqual({
      whiteShare: 0,
      label: "0-1 #",
      barText: "0-1"
    });
    const stalemate = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1";
    expect(liveAnalysisEval(stalemate, null)).toEqual({
      whiteShare: 50,
      label: "½-½",
      barText: "½-½"
    });
  });
});

describe("barScoreText", () => {
  it("prints the size of the edge without a sign, whoever has it", () => {
    expect(barScoreText({ type: "cp", value: 450 })).toBe("4.5");
    expect(barScoreText({ type: "cp", value: -450 })).toBe("4.5");
    expect(barScoreText({ type: "cp", value: 0 })).toBe("0.0");
    expect(barScoreText({ type: "cp", value: -4 })).toBe("0.0");
  });

  it("drops the decimal from ten pawns up, so it fits the bar", () => {
    expect(barScoreText({ type: "cp", value: 994 })).toBe("9.9");
    expect(barScoreText({ type: "cp", value: 996 })).toBe("10");
    expect(barScoreText({ type: "cp", value: -1234 })).toBe("12");
  });

  it("prints a forced mate as M and its length", () => {
    expect(barScoreText({ type: "mate", value: 3 })).toBe("M3");
    expect(barScoreText({ type: "mate", value: -2 })).toBe("M2");
  });
});

describe("evalBarLabel", () => {
  const white = { whiteShare: 80, barText: "2.3" };
  const black = { whiteShare: 20, barText: "2.3" };

  it("sits at the better side's end: White's at the bottom, Black's at the top", () => {
    expect(evalBarLabel(white, "white")).toEqual({ text: "2.3", side: "white", atTop: false });
    expect(evalBarLabel(black, "white")).toEqual({ text: "2.3", side: "black", atTop: true });
  });

  it("follows a flipped board: White's end is then at the top", () => {
    expect(evalBarLabel(white, "black")).toEqual({ text: "2.3", side: "white", atTop: true });
    expect(evalBarLabel(black, "black")).toEqual({ text: "2.3", side: "black", atTop: false });
  });

  it("puts an even score at White's end, as the fill does", () => {
    expect(evalBarLabel({ whiteShare: 50, barText: "0.0" }, "white").side).toBe("white");
    expect(evalBarLabel({ whiteShare: 50, barText: "½-½" }, "black").atTop).toBe(true);
  });
});

describe("reviewedMoveEval", () => {
  const blackToMove = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

  it("shows the result of a move that ends the game", () => {
    // Black mates: stored as `mate 0` (White, to move, is mated).
    expect(
      reviewedMoveEval({
        fenBefore: blackToMove,
        evalAfter: { type: "mate", value: 0 },
        terminal: "checkmate"
      })
    ).toEqual({ whiteShare: 0, label: "0-1 #", barText: "0-1" });
    expect(
      reviewedMoveEval({
        fenBefore: blackToMove,
        evalAfter: { type: "cp", value: 0 },
        terminal: "stalemate"
      })
    ).toEqual({ whiteShare: 50, label: "½-½", barText: "½-½" });
  });

  it("shows the evaluation after any other move, and nothing without one", () => {
    const move: Pick<MoveReview, "evalAfter" | "fenBefore" | "terminal"> = {
      fenBefore: blackToMove,
      evalAfter: { type: "mate", value: -3 },
      terminal: null
    };
    expect(reviewedMoveEval(move)).toEqual({ whiteShare: 0, label: "M-3", barText: "M3" });
    expect(reviewedMoveEval({ ...move, evalAfter: null })).toBeNull();
  });
});
