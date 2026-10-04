import { describe, expect, it } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import { gameFingerprint, lichessGameId } from "./game-fingerprint";

const OPERA = `[White "Paul Morphy"]\n[Black "Duke Karl"]\n[Date "1858.11.02"]\n\n1. e4 e5 2. Nf3 d6 1-0`;
const fingerprintOf = (pgn: string) => gameFingerprint(importPgnText(pgn).game);

describe("gameFingerprint", () => {
  it("is the same for the same game whatever the annotations, case or spacing", () => {
    const annotated = `[White "paul  morphy"]\n[Black "Duke Karl"]\n[Date "1858.11.02"]\n[Event "Opera"]\n\n1. e4 {a comment} e5 (1... c5) 2. Nf3 d6 1-0`;
    expect(fingerprintOf(annotated)).toBe(fingerprintOf(OPERA));
  });

  it("differs for other moves, players or date", () => {
    expect(fingerprintOf(OPERA.replace("2. Nf3", "2. Nc3"))).not.toBe(fingerprintOf(OPERA));
    expect(fingerprintOf(OPERA.replace("Duke Karl", "Count Isouard"))).not.toBe(
      fingerprintOf(OPERA)
    );
    expect(fingerprintOf(OPERA.replace("1858.11.02", "1858.11.03"))).not.toBe(fingerprintOf(OPERA));
    // Unknown values are the same as missing ones.
    expect(fingerprintOf(OPERA.replace('[Date "1858.11.02"]', '[Date "????.??.??"]'))).toBe(
      fingerprintOf(OPERA.replace('[Date "1858.11.02"]\n', ""))
    );
  });

  it("is none for a game with nothing identifying it (anonymous games with the same moves may be unrelated)", () => {
    expect(fingerprintOf(`[Event "?"]\n\n1. e4 e5 *`)).toBeNull();
    expect(fingerprintOf(`[White "?"]\n[Black "?"]\n[Date "????.??.??"]\n\n1. e4 e5 *`)).toBeNull();
  });

  it("is the Lichess game for a game from lichess.org", () => {
    expect(fingerprintOf(`[Site "https://lichess.org/abcdEFGH"]\n\n1. d4 *`)).toBe(
      "lichess:abcdEFGH"
    );
    expect(lichessGameId("https://lichess.org/abcdEFGHwxyz")).toBe("abcdEFGH");
    expect(lichessGameId("https://lichess.org/abcdEFGH/black")).toBe("abcdEFGH");
    expect(lichessGameId("Paris FRA")).toBeNull();
  });
});
