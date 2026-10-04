import { describe, expect, it } from "vitest";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import {
  barScoreSide,
  barScoreText,
  evalBarLabel,
  evalShare,
  liveAnalysisEval,
  reviewedMoveEval,
  scoreEval
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
      barText: "0.5",
      barSide: "black"
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
      barText: "0-1",
      barSide: "black"
    });
    const stalemate = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1";
    expect(liveAnalysisEval(stalemate, null)).toEqual({
      whiteShare: 50,
      label: "½-½",
      barText: "½-½",
      barSide: "white"
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

describe("barScoreSide", () => {
  it("is the better side's", () => {
    expect(barScoreSide({ type: "cp", value: 230 })).toBe("white");
    expect(barScoreSide({ type: "cp", value: -230 })).toBe("black");
    expect(barScoreSide({ type: "mate", value: 3 })).toBe("white");
    expect(barScoreSide({ type: "mate", value: -2 })).toBe("black");
  });

  it("is White's for any score that prints 0.0, as for an exact 0", () => {
    expect(barScoreSide({ type: "cp", value: 0 })).toBe("white");
    expect(barScoreSide({ type: "cp", value: 4 })).toBe("white");
    expect(barScoreSide({ type: "cp", value: -4 })).toBe("white");
    // From -5 the bar prints 0.1, Black's edge.
    expect(barScoreText({ type: "cp", value: -5 })).toBe("0.1");
    expect(barScoreSide({ type: "cp", value: -5 })).toBe("black");
  });
});

describe("evalBarLabel", () => {
  const white = { barSide: "white", barText: "2.3" } as const;
  const black = { barSide: "black", barText: "2.3" } as const;

  it("sits at the better side's end: White's at the bottom, Black's at the top", () => {
    expect(evalBarLabel(white, "white")).toEqual({ text: "2.3", side: "white", atTop: false });
    expect(evalBarLabel(black, "white")).toEqual({ text: "2.3", side: "black", atTop: true });
  });

  it("follows a flipped board: White's end is then at the top", () => {
    expect(evalBarLabel(white, "black")).toEqual({ text: "2.3", side: "white", atTop: true });
    expect(evalBarLabel(black, "black")).toEqual({ text: "2.3", side: "black", atTop: false });
  });

  it("puts a near-even score at White's end, the same end as an exact 0", () => {
    // Its fill dips just below even, but its text still reads 0.0 at White's end.
    const nearEven = scoreEval({ type: "cp", value: -4 });
    expect(nearEven.whiteShare).toBeLessThan(50);
    expect(evalBarLabel(nearEven, "white")).toEqual({ text: "0.0", side: "white", atTop: false });
    expect(evalBarLabel(nearEven, "black").atTop).toBe(true);
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
    ).toEqual({ whiteShare: 0, label: "0-1 #", barText: "0-1", barSide: "black" });
    expect(
      reviewedMoveEval({
        fenBefore: blackToMove,
        evalAfter: { type: "cp", value: 0 },
        terminal: "stalemate"
      })
    ).toEqual({ whiteShare: 50, label: "½-½", barText: "½-½", barSide: "white" });
  });

  it("shows the evaluation after any other move, and nothing without one", () => {
    const move: Pick<MoveReview, "evalAfter" | "fenBefore" | "terminal"> = {
      fenBefore: blackToMove,
      evalAfter: { type: "mate", value: -3 },
      terminal: null
    };
    expect(reviewedMoveEval(move)).toEqual({
      whiteShare: 0,
      label: "M-3",
      barText: "M3",
      barSide: "black"
    });
    expect(reviewedMoveEval({ ...move, evalAfter: null })).toBeNull();
  });
});
