import { describe, expect, it } from "vitest";
import { emptyHeaders, parsePgn } from "chessops/pgn";
import type { Game, PgnNodeData } from "chessops/pgn";
import { createPgnGameSplitter } from "./pgn-game-splitter";

const TRICKY = `\uFEFF[Event "Quotes \\"inside\\" and a \\\\ backslash"]
[White "A"]
[Black "B"]

{ A comment that quotes a tag:
[Event "Not a game"]
and goes on } 1. e4 { [Event "still a comment"] } e5 (1... c5 { inner }) 2. Nf3 *

[Event "Second"]

1. d4 d5 *\r\n\r\n[Event "Third, CRLF and no final newline"]\r\n\r\n1. c4 *`;

/** Every game the splitter emits when the text arrives in pieces of `size` characters. */
function split(text: string, size: number): Game<PgnNodeData>[] {
  const games: Game<PgnNodeData>[] = [];
  const splitter = createPgnGameSplitter((game) => games.push(game));
  for (let start = 0; start < text.length; start += size) {
    splitter.write(text.slice(start, start + size));
  }
  splitter.end();
  return games;
}

describe("createPgnGameSplitter", () => {
  it("gives the games parsePgn gives, whatever the chunk boundaries", () => {
    const whole = parsePgn(TRICKY, emptyHeaders);
    expect(whole.map((game) => game.headers.get("Event"))).toEqual([
      'Quotes "inside" and a \\ backslash',
      "Second",
      "Third, CRLF and no final newline"
    ]);
    for (const size of [1, 2, 3, 7, 16, 61, TRICKY.length]) {
      expect(split(TRICKY, size)).toEqual(whole);
    }
  });

  it("keeps a tag line inside a comment as comment text", () => {
    const [first] = split(TRICKY, 5);
    expect(first.comments?.[0]).toContain('[Event "Not a game"]');
    expect(first.moves.children[0].data.comments).toEqual(['[Event "still a comment"]']);
  });

  it("hands games on as soon as they end, and the last one at the end", () => {
    const seen: string[] = [];
    const splitter = createPgnGameSplitter((game) => seen.push(game.headers.get("Event") ?? ""));
    splitter.write('[Event "One"]\n\n1. e4 *\n\n[Event "Two"]\n\n1. d4');
    expect(seen).toEqual(["One"]);
    splitter.write(" d5 *");
    expect(seen).toEqual(["One"]);
    splitter.end();
    expect(seen).toEqual(["One", "Two"]);
  });

  it("stops at the first error the callback throws", () => {
    let calls = 0;
    const splitter = createPgnGameSplitter(() => {
      calls += 1;
      throw new Error("limit");
    });
    expect(() =>
      splitter.write('[Event "One"]\n\n1. e4 *\n\n[Event "Two"]\n\n1. d4 *\n\n')
    ).toThrow("limit");
    expect(() => splitter.write("1. c4 *\n\n")).toThrow("limit");
    expect(() => splitter.end()).toThrow("limit");
    expect(calls).toBe(1);
  });
});
