import { describe, expect, it } from "vitest";
import { applySan, START_FEN } from "./position";
import { playerToMove, positionKey } from "./repertoire-position";

function play(...sans: string[]): string {
  let fen = START_FEN;
  for (const san of sans) {
    const applied = applySan(fen, san);
    if (!applied) throw new Error(`illegal ${san}`);
    fen = applied.fen;
  }
  return fen;
}

describe("positionKey", () => {
  it("is versioned and leaves out the move counters", () => {
    expect(positionKey(START_FEN)).toBe("v1:rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -");
  });

  it("matches genuine transpositions even when the counters differ", () => {
    const viaKnight = play("Nf3", "d5", "d4");
    const viaPawn = play("d4", "d5", "Nf3");
    expect(viaKnight).not.toBe(viaPawn); // halfmove clocks differ
    expect(positionKey(viaKnight)).toBe(positionKey(viaPawn));
  });

  it("ignores halfmove and fullmove numbers", () => {
    const base = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq -";
    expect(positionKey(`${base} 2 3`)).toBe(positionKey(`${base} 0 17`));
  });

  it("distinguishes the side to move", () => {
    const placement = "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R";
    expect(positionKey(`${placement} w KQkq - 0 1`)).not.toBe(
      positionKey(`${placement} b KQkq - 0 1`)
    );
  });

  it("distinguishes castling rights, and keeps obstructed rights", () => {
    const placement = "r3k2r/8/8/8/8/8/8/R3K2R w";
    expect(positionKey(`${placement} KQkq - 0 1`)).not.toBe(positionKey(`${placement} Kkq - 0 1`));
    // Castling is blocked by pieces in the start position, but the rights stay part of the key.
    expect(positionKey(START_FEN)).toContain(" KQkq ");
  });

  it("drops castling rights no king/rook can back", () => {
    // No rook on h1: the K right is meaningless.
    expect(positionKey("r3k2r/8/8/8/8/8/8/R3K3 w KQkq - 0 1")).toBe(
      positionKey("r3k2r/8/8/8/8/8/8/R3K3 w Qkq - 0 1")
    );
  });

  it("keeps an en-passant square when the capture is legal", () => {
    const placement = "rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq";
    expect(positionKey(`${placement} e3 0 3`)).toContain(" e3");
    expect(positionKey(`${placement} e3 0 3`)).not.toBe(positionKey(`${placement} - 0 3`));
  });

  it("drops an en-passant square no pawn can capture on", () => {
    // A FEN writer that always records the double-step square (as many PGN tools do).
    const afterE4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
    expect(positionKey(afterE4)).toBe(
      positionKey("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1")
    );
  });

  it("drops an en-passant square when the capture would expose the king", () => {
    // bxc6 e.p. clears b5 and c5, opening the h5 rook onto the a5 king.
    const pinned = "4k3/8/8/KPp4r/8/8/8/8 w - c6 0 2";
    expect(positionKey(pinned)).toBe(positionKey("4k3/8/8/KPp4r/8/8/8/8 w - - 0 2"));
    // With the rook elsewhere the same capture is legal and stays in the key.
    expect(positionKey("4k3/8/8/KPp5/8/8/8/7r w - c6 0 2")).toContain(" c6");
  });

  it("throws on an invalid FEN or position", () => {
    expect(() => positionKey("not a fen")).toThrow(/Invalid FEN/);
    expect(() => positionKey("8/8/8/8/8/8/8/8 w - - 0 1")).toThrow(/Illegal position/);
  });
});

describe("playerToMove", () => {
  it("reads the side to move", () => {
    expect(playerToMove(START_FEN)).toBe("white");
    expect(playerToMove(play("e4"))).toBe("black");
    expect(() => playerToMove("x")).toThrow(/Invalid FEN/);
  });
});
