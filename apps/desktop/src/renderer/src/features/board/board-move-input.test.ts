import { describe, expect, it } from "vitest";
import { START_FEN } from "@chaturanga/shared/chess/position";
import { parseTypedMove, resolveBoardMove } from "./board-move-input";

const PROMOTION = "8/4P3/8/8/8/8/k7/4K3 w - - 0 1";
const CASTLING = "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1";
const CAPTURE = "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";

function uciOf(fen: string, text: string): string | null {
  const result = parseTypedMove(fen, text);
  return result.ok ? result.move.uci : null;
}

describe("parseTypedMove", () => {
  it("reads SAN", () => {
    expect(parseTypedMove(START_FEN, "Nf3")).toEqual({
      ok: true,
      move: {
        uci: "g1f3",
        san: "Nf3",
        fenAfter: "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1"
      }
    });
    expect(uciOf(CAPTURE, "exd5")).toBe("e4d5");
    expect(uciOf(START_FEN, "  e4  ")).toBe("e2e4");
  });

  it("accepts a lowercase piece letter, check marks and trailing annotations", () => {
    expect(uciOf(START_FEN, "nf3")).toBe("g1f3");
    expect(uciOf(START_FEN, "Nf3!?")).toBe("g1f3");
    expect(uciOf(PROMOTION, "e8=Q+")).toBe("e7e8q");
  });

  it("reads castling as O-O or 0-0 and reports standard king-destination UCI", () => {
    expect(uciOf(CASTLING, "O-O")).toBe("e1g1");
    expect(uciOf(CASTLING, "0-0")).toBe("e1g1");
    expect(uciOf(CASTLING, "o-o-o")).toBe("e1c1");
    expect(parseTypedMove(CASTLING, "O-O-O")).toMatchObject({ ok: true, move: { san: "O-O-O" } });
  });

  it("reads square-to-square moves", () => {
    expect(uciOf(START_FEN, "e2e4")).toBe("e2e4");
    expect(uciOf(START_FEN, "E2-E4")).toBe("e2e4");
    expect(uciOf(CASTLING, "e1g1")).toBe("e1g1");
  });

  it("keeps the chosen promotion piece, including underpromotion", () => {
    expect(uciOf(PROMOTION, "e8=Q")).toBe("e7e8q");
    expect(uciOf(PROMOTION, "e8=N")).toBe("e7e8n");
    expect(uciOf(PROMOTION, "e8r")).toBe("e7e8r");
    expect(uciOf(PROMOTION, "e7e8b")).toBe("e7e8b");
    expect(uciOf(PROMOTION, "e7e8=n")).toBe("e7e8n");
  });

  it("explains empty, illegal and unreadable input", () => {
    expect(parseTypedMove(START_FEN, "   ")).toEqual({
      ok: false,
      error: "Type a move, like Nf3 or e2e4."
    });
    expect(parseTypedMove(START_FEN, "Nf6")).toEqual({
      ok: false,
      error: "Nf6 isn't a legal move here."
    });
    expect(parseTypedMove(START_FEN, "e2e5").ok).toBe(false);
    expect(parseTypedMove(PROMOTION, "e7e8").ok).toBe(false);
    expect(parseTypedMove(PROMOTION, "e8").ok).toBe(false);
    expect(parseTypedMove("not a fen", "e4").ok).toBe(false);
  });
});

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
