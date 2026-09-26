import { describe, expect, it } from "vitest";
import {
  classifyMove,
  formatEngineScore,
  reviewLabel,
  scoreFromWhitePerspective,
  scoreToCentipawns,
  standardCastlingUci,
  terminalStateForFen
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
    expect(
      classifyMove({ playedMove: "a", bestMove: null, evalLoss: null, hasMissedTactic: false })
    ).toBe("good");
    expect(
      classifyMove({ playedMove: "a", bestMove: "b", evalLoss: 10, hasMissedTactic: false })
    ).toBe("best");
    expect(
      classifyMove({ playedMove: "a", bestMove: "b", evalLoss: 25, hasMissedTactic: false })
    ).toBe("excellent");
    expect(
      classifyMove({ playedMove: "a", bestMove: "b", evalLoss: 70, hasMissedTactic: false })
    ).toBe("good");
    expect(
      classifyMove({ playedMove: "a", bestMove: "b", evalLoss: 120, hasMissedTactic: false })
    ).toBe("inaccuracy");
    expect(
      classifyMove({ playedMove: "a", bestMove: "b", evalLoss: 250, hasMissedTactic: false })
    ).toBe("mistake");
    expect(
      classifyMove({ playedMove: "a", bestMove: "b", evalLoss: 400, hasMissedTactic: false })
    ).toBe("blunder");
  });

  it("labels review classifications", () => {
    expect(
      ["best", "excellent", "good", "inaccuracy", "mistake", "blunder", "missed_tactic"].map(
        (item) => reviewLabel(item as Parameters<typeof reviewLabel>[0])
      )
    ).toEqual(["Best", "Excellent", "Good", "Inaccuracy", "Mistake", "Blunder", "Missed tactic"]);
  });

  it("converts mate scores to large centipawn sentinels", () => {
    expect(scoreToCentipawns({ type: "cp", value: -12 })).toBe(-12);
    // mate 0 = the side to move is checkmated → a loss, not a win.
    expect(scoreToCentipawns({ type: "mate", value: 0 })).toBe(-100000);
    expect(scoreToCentipawns({ type: "mate", value: -2 })).toBeLessThan(-99000);
    expect(scoreToCentipawns({ type: "mate", value: 2 })).toBeGreaterThan(99000);
  });

  it("ranks faster mates higher so mate-in-N vs mate-in-M is a small loss", () => {
    const m2 = scoreToCentipawns({ type: "mate", value: 2 });
    const m5 = scoreToCentipawns({ type: "mate", value: 5 });
    expect(m2 - m5).toBe(30);
    expect(scoreToCentipawns({ type: "mate", value: -5 })).toBeGreaterThan(
      scoreToCentipawns({ type: "mate", value: -1 })
    );
  });

  it("normalizes king-takes-rook castling to standard UCI", () => {
    const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    expect(standardCastlingUci(fen, "e1h1")).toBe("e1g1");
    expect(standardCastlingUci(fen, "e1a1")).toBe("e1c1");
    expect(standardCastlingUci(fen.replace(" w ", " b "), "e8h8")).toBe("e8g8");
    expect(standardCastlingUci(fen, "e1g1")).toBe("e1g1");
    expect(standardCastlingUci(fen, "a1a8")).toBe("a1a8");
  });

  it("detects terminal positions from the FEN", () => {
    expect(
      terminalStateForFen("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3")
    ).toBe("checkmate");
    expect(terminalStateForFen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")).toBe("stalemate");
    expect(terminalStateForFen("8/8/4k3/8/8/4K3/8/8 w - - 0 1")).toBe("draw");
    expect(
      terminalStateForFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")
    ).toBeNull();
  });
});
