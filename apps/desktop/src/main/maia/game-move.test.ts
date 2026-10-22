import { describe, expect, it } from "vitest";
import { maiaGameQuery } from "./game-move";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4_E5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";

describe("maiaGameQuery", () => {
  it("reads the position after the game's moves, at Maia's rating against the user's", () => {
    expect(
      maiaGameQuery({
        fen: START,
        moves: ["e2e4", "e7e5"],
        maia: { rating: 1900, opponentRating: 1234 }
      })
    ).toStrictEqual({ fen: AFTER_E4_E5, eloSelf: 1900, eloOppo: 1234 });
  });

  it("plays at the default rating against an equal opponent when the game gives none", () => {
    expect(maiaGameQuery({ fen: START, moves: [], maia: null })).toStrictEqual({
      fen: START,
      eloSelf: 1500,
      eloOppo: 1500
    });
  });

  it("refuses a game with an illegal move", () => {
    expect(() => maiaGameQuery({ fen: START, moves: ["e2e5"] })).toThrow(/illegal move \(e2e5\)/);
  });
});
