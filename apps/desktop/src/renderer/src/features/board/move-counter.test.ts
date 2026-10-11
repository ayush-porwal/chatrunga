import { describe, expect, it } from "vitest";
import { blackToMove, fullMoveCount } from "./move-counter";

describe("fullMoveCount", () => {
  it("counts White's move and Black's reply as one move", () => {
    // 40 plies: 20 moves; after 6… O-O (12 plies) it's move 6.
    expect(fullMoveCount(40)).toBe(20);
    expect(fullMoveCount(12)).toBe(6);
    expect(fullMoveCount(2)).toBe(1);
  });

  it("counts a White move still waiting for its reply as a move", () => {
    // After 7. a4 (13 plies): move 7.
    expect(fullMoveCount(13)).toBe(7);
    expect(fullMoveCount(1)).toBe(1);
  });

  it("is 0 at the start", () => {
    expect(fullMoveCount(0)).toBe(0);
    expect(fullMoveCount(0, true)).toBe(0);
  });

  it("counts Black's opening move as a move of its own from a Black-to-move start", () => {
    // 1… e5 · 2. Nf3 Nc6 · 3. Bb5
    expect(fullMoveCount(1, true)).toBe(1);
    expect(fullMoveCount(2, true)).toBe(2);
    expect(fullMoveCount(3, true)).toBe(2);
    expect(fullMoveCount(4, true)).toBe(3);
  });
});

describe("blackToMove", () => {
  it("reads the side to move from a FEN", () => {
    expect(blackToMove("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1")).toBe(true);
    expect(blackToMove("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")).toBe(false);
    expect(blackToMove(null)).toBe(false);
  });
});
