import { describe, expect, it } from "vitest";
import { START_FEN } from "@chaturanga/shared/chess/position";
import { resolveBoardMove } from "./board-move-input";

const PROMOTION = "8/4P3/8/8/8/8/k7/4K3 w - - 0 1";
const CASTLING = "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1";

describe("resolveBoardMove", () => {
  it("resolves a legal board move with SAN and the FEN after", () => {
    expect(resolveBoardMove(START_FEN, "e2", "e4")).toEqual({
      uci: "e2e4",
      san: "e4",
      fenAfter: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    });
  });

  it("adds the promotion suffix for the chosen piece", () => {
    expect(resolveBoardMove(PROMOTION, "e7", "e8", "queen")?.uci).toBe("e7e8q");
    expect(resolveBoardMove(PROMOTION, "e7", "e8", "knight")).toMatchObject({
      uci: "e7e8n",
      san: "e8=N"
    });
  });

  it("normalises castling onto the rook to the king's destination", () => {
    expect(resolveBoardMove(CASTLING, "e1", "h1")?.uci).toBe("e1g1");
    expect(resolveBoardMove(CASTLING, "e1", "g1")?.uci).toBe("e1g1");
    expect(resolveBoardMove(CASTLING, "e1", "a1")?.uci).toBe("e1c1");
  });

  it("returns null for illegal moves, non-squares and unreadable positions", () => {
    expect(resolveBoardMove(START_FEN, "e2", "e5")).toBeNull();
    expect(resolveBoardMove(START_FEN, "a0", "e4")).toBeNull();
    expect(resolveBoardMove(PROMOTION, "e7", "e8")).toBeNull();
    expect(resolveBoardMove("nope", "e2", "e4")).toBeNull();
  });
});
