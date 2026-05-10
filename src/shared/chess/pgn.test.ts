import { describe, expect, it } from "vitest";
import { exportGameToPgn, importPgnText } from "./pgn";

describe("PGN import/export", () => {
  it("imports a simple PGN and builds a move tree", () => {
    const imported = importPgnText('[Event "Demo"]\n[White "A"]\n[Black "B"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 *');
    expect(imported.game.headers.event).toBe("Demo");
    expect(imported.game.moveTree.filter((node) => node.uci).map((node) => node.uci)).toEqual([
      "e2e4",
      "e7e5",
      "g1f3"
    ]);
  });

  it("round trips PGN arrows", () => {
    const imported = importPgnText('1. e4 { [%cal Gg1f3] [%csl Ye4] } *');
    const node = imported.game.moveTree.find((item) => item.uci === "e2e4");
    expect(node?.arrows).toEqual([{ color: "green", orig: "g1", dest: "f3" }]);
    expect(node?.highlights).toEqual([{ color: "yellow", square: "e4" }]);
    expect(exportGameToPgn(imported.game)).toContain("[%cal Gg1f3]");
  });
});
