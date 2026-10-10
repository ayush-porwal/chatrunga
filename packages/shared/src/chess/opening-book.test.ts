import { describe, expect, it } from "vitest";
import {
  classifyOpening,
  inBook,
  openingAt,
  parseOpeningBook,
  positionKey,
  type BookLineMove,
  type OpeningBook
} from "./opening-book";
import { openingBookText } from "./opening-book-data";
import { applySan, START_FEN } from "./position";

let bundled: OpeningBook | null = null;
/** The bundled book (read once for the file). */
function book(): OpeningBook {
  bundled ??= parseOpeningBook(openingBookText());
  return bundled;
}

/** A main line from `fen`, as a review stores it. */
function line(sans: string, fen = START_FEN): BookLineMove[] {
  const moves: BookLineMove[] = [];
  let at = fen;
  for (const san of sans.split(" ")) {
    const played = applySan(at, san);
    if (!played) throw new Error(`illegal ${san}`);
    moves.push({ ply: moves.length + 1, san: played.san, fenAfter: played.fen });
    at = played.fen;
  }
  return moves;
}

describe("the opening book's data", () => {
  it("reads every named position and the positions on the way to them", () => {
    const named = [...book().values()].filter((name) => name !== null);
    expect(named.length).toBeGreaterThan(3800);
    expect(book().size).toBeGreaterThan(named.length);
    expect(inBook(book(), START_FEN)).toBe(true);
    expect(openingAt(book(), START_FEN)).toBeNull();
  });

  it("refuses a row that doesn't replay", () => {
    expect(() => parseOpeningBook("1\te2e4\n3\te7e5")).toThrow(/Bad opening book row/);
    expect(() => parseOpeningBook("1\te2e5")).toThrow(/Bad opening book row/);
  });

  it("keys positions by EPD, with en passant only when it can be taken", () => {
    // After 1. e4 the FEN may name e3, but no black pawn can take there.
    const withSquare = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
    const withoutSquare = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    expect(positionKey(withSquare)).toBe(positionKey(withoutSquare));
    expect(openingAt(book(), withSquare)).toEqual({ eco: "B00", name: "King's Pawn Game" });
    expect(positionKey("not a fen")).toBeNull();
    expect(inBook(book(), "not a fen")).toBe(false);
  });
});

describe("classifyOpening", () => {
  it("names the deepest named position, and the game still in the book has no first non-book move", () => {
    expect(classifyOpening(book(), line("e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6"))).toEqual({
      // 4. Nxd4 and 5. Nc3 reach unnamed positions on the way to named ones: still the book.
      book: Array(10).fill(true),
      opening: {
        eco: "B90",
        name: "Sicilian Defense: Najdorf Variation",
        ply: 10,
        bookEndPly: 10,
        firstNonBookMove: null
      }
    });
  });

  it("ends the book at the last book move and names the move that left it", () => {
    const result = classifyOpening(book(), line("e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 h4 b5"));
    expect(result.book).toEqual([...Array(10).fill(true), false, false]);
    expect(result.opening).toEqual({
      eco: "C84",
      name: "Ruy Lopez: Closed",
      ply: 10,
      bookEndPly: 10,
      firstNonBookMove: { ply: 11, san: "h4" }
    });
  });

  it("finds the opening by position whatever the move order (a transposition)", () => {
    const direct = classifyOpening(book(), line("d4 d5 c4 e6 Nc3 Nf6"));
    // The English move order steps out of the book at 2… d5 and back in with 3. d4.
    const english = classifyOpening(book(), line("c4 e6 Nc3 d5 d4 Nf6"));
    expect(english.book).toEqual([true, true, true, false, true, true]);
    expect(direct.opening).toEqual({
      eco: "D35",
      name: "Queen's Gambit Declined: Normal Defense",
      ply: 6,
      bookEndPly: 6,
      firstNonBookMove: null
    });
    expect(english.opening).toEqual(direct.opening);
    expect(classifyOpening(book(), line("Nf3 d5 d4")).opening).toMatchObject({
      eco: "D02",
      name: "Queen's Pawn Game: Zukertort Variation"
    });
    expect(classifyOpening(book(), line("d4 d5 Nf3")).opening).toMatchObject({
      eco: "D02",
      name: "Queen's Pawn Game: Zukertort Variation"
    });
  });

  it("classifies a game set up from a book position from there", () => {
    const afterE4 = applySan(START_FEN, "e4")?.fen ?? "";
    const result = classifyOpening(book(), line("c5", afterE4));
    expect(result).toEqual({
      book: [true],
      opening: {
        eco: "B20",
        name: "Sicilian Defense",
        ply: 1,
        bookEndPly: 1,
        firstNonBookMove: null
      }
    });
  });

  it("names nothing for a game that never reaches a named position", () => {
    expect(classifyOpening(book(), [])).toEqual({ book: [], opening: null });
    // A game from a set-up position far from any opening.
    const endgame = line("Kd2 Kd7", "4k3/8/8/8/8/8/8/4K3 w - - 0 1");
    expect(classifyOpening(book(), endgame)).toEqual({ book: [false, false], opening: null });
  });
});
