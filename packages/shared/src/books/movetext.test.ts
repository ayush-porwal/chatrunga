import { describe, expect, it } from "vitest";
import { symbolsToNags, tokenizeMovetext } from "./movetext";

const sans = (text: string) => tokenizeMovetext(text).map((token) => token.san);

describe("tokenizeMovetext", () => {
  it("reads numbered moves with and without dots, and Black's numbers with dots", () => {
    expect(tokenizeMovetext("1. e4 c5 2 Nf3 d6 3...Nf6")).toStrictEqual([
      { number: 1, black: false, numbered: true, san: "e4", symbols: null, raw: "e4" },
      { number: 1, black: true, numbered: false, san: "c5", symbols: null, raw: "c5" },
      { number: 2, black: false, numbered: true, san: "Nf3", symbols: null, raw: "Nf3" },
      { number: 2, black: true, numbered: false, san: "d6", symbols: null, raw: "d6" },
      { number: 3, black: true, numbered: true, san: "Nf6", symbols: null, raw: "3...Nf6" }
    ]);
  });

  it("takes a spaced or typographic ellipsis as Black's move", () => {
    expect(
      tokenizeMovetext("15 ... Rfd8 16 Rd2 16… Rc5").map(({ number, black, san }) => ({
        number,
        black,
        san
      }))
    ).toStrictEqual([
      { number: 15, black: true, san: "Rfd8" },
      { number: 16, black: false, san: "Rd2" },
      { number: 16, black: true, san: "Rc5" }
    ]);
  });

  it("writes castling with zeros as SAN castling and keeps its check", () => {
    expect(sans("5 0-0 0-0-0+ 6 O-O")).toStrictEqual(["O-O", "O-O-O+", "O-O"]);
  });

  it("drops results and moves symbols glued to a move, or standing alone, onto it", () => {
    const tokens = tokenizeMovetext("1. e4!? e5 2. Qh5?! ± Nc6 3. Bc4 g6?? 4. Qxf7# 1-0");
    expect(tokens.map(({ san, symbols }) => [san, symbols])).toStrictEqual([
      ["e4", "!?"],
      ["e5", null],
      ["Qh5", "?!±"],
      ["Nc6", null],
      ["Bc4", null],
      ["g6", "??"],
      ["Qxf7#", null]
    ]);
  });

  it("reads +- after a move as an evaluation, not a check", () => {
    expect(tokenizeMovetext("20 Qxd5+- Kh8+")).toMatchObject([
      { san: "Qxd5", symbols: "+-" },
      { san: "Kh8+", symbols: null }
    ]);
  });

  it("reads figurines, promotions and comments", () => {
    expect(sans("1 ♘f3 {a quiet move} ♞f6 2 e8=Q+ ♗×c4")).toStrictEqual([
      "Nf3",
      "Nf6",
      "e8=Q+",
      "Bxc4"
    ]);
  });

  it("keeps an unreadable move so its line is reported, not silently shortened", () => {
    expect(sans("1 e4 c5 2 N!f3")).toStrictEqual(["e4", "c5", "N"]);
  });
});

describe("symbolsToNags", () => {
  it.each([
    ["!", ["$1"]],
    ["?", ["$2"]],
    ["!!", ["$3"]],
    ["??", ["$4"]],
    ["!?", ["$5"]],
    ["?!", ["$6"]],
    ["=", ["$10"]],
    ["∞", ["$13"]],
    ["+=", ["$14"]],
    ["⩲", ["$14"]],
    ["=+", ["$15"]],
    ["±", ["$16"]],
    ["+/-", ["$16"]],
    ["∓", ["$17"]],
    ["+-", ["$18"]],
    ["-+", ["$19"]]
  ])("maps %s to %j", (symbols, nags) => {
    expect(symbolsToNags(symbols)).toStrictEqual(nags);
  });

  it("reads several symbols, keeps $n NAGs and skips unknown marks once each", () => {
    expect(symbolsToNags("!? ± $22 N !?")).toStrictEqual(["$5", "$16", "$22"]);
    expect(symbolsToNags(null)).toStrictEqual([]);
  });
});
