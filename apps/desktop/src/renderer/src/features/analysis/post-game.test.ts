import { describe, expect, it } from "vitest";
import { boardResultPatch, engineGameEnded, userSide, userWon } from "./post-game";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
/** Fool's mate: White is mated. */
const BLACK_MATES = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";
/** Black to move, no legal move, not in check. */
const STALEMATE = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1";

describe("engineGameEnded", () => {
  const game = {
    mode: "engine" as const,
    engineSide: "black" as const,
    gameOutcome: null,
    endFen: START
  };

  it("is over once a result is decided (resignation, flag, agreement)", () => {
    expect(engineGameEnded(game)).toBe(false);
    expect(
      engineGameEnded({ ...game, gameOutcome: { result: "0-1", termination: "Player resign" } })
    ).toBe(true);
  });

  it("is over when the main line ends in mate or stalemate, wherever the cursor is", () => {
    expect(engineGameEnded({ ...game, endFen: BLACK_MATES })).toBe(true);
    expect(engineGameEnded({ ...game, endFen: STALEMATE })).toBe(true);
  });

  it("only applies to an engine game with an engine side", () => {
    expect(engineGameEnded({ ...game, mode: "freeplay", endFen: BLACK_MATES })).toBe(false);
    expect(engineGameEnded({ ...game, mode: "online", endFen: BLACK_MATES })).toBe(false);
    expect(engineGameEnded({ ...game, engineSide: null, endFen: BLACK_MATES })).toBe(false);
  });
});

describe("userSide / userWon", () => {
  it("is the side the engine or the Lichess opponent doesn't play", () => {
    expect(userSide("engine", "black")).toBe("white");
    expect(userSide("online", "white")).toBe("black");
    expect(userSide("freeplay", "black")).toBeNull();
    expect(userSide("engine", null)).toBeNull();
  });

  it("is a win only when the result goes to the user's side", () => {
    expect(userWon("1-0", "engine", "black")).toBe(true);
    expect(userWon("0-1", "online", "white")).toBe(true);
    expect(userWon("0-1", "engine", "black")).toBe(false);
    expect(userWon("1/2-1/2", "engine", "black")).toBe(false);
    expect(userWon("*", "engine", "black")).toBe(false);
  });

  it("never counts a result the user only watched", () => {
    expect(userWon("1-0", "freeplay", null)).toBe(false);
    expect(userWon("1-0", "analysis", "black")).toBe(false);
    expect(userWon("1-0", "puzzle", null)).toBe(false);
  });
});

describe("boardResultPatch", () => {
  it("adds the result of a game that ended on the board", () => {
    expect(
      boardResultPatch({ gameOutcome: null, headers: { result: "*" }, endFen: BLACK_MATES })
    ).toEqual({ result: "0-1" });
    expect(
      boardResultPatch({ gameOutcome: null, headers: { result: "*" }, endFen: STALEMATE })
    ).toEqual({ result: "1/2-1/2" });
  });

  it("leaves a recorded result, a decided outcome and an unfinished game alone", () => {
    expect(
      boardResultPatch({ gameOutcome: null, headers: { result: "0-1" }, endFen: BLACK_MATES })
    ).toBeNull();
    expect(
      boardResultPatch({
        gameOutcome: { result: "1-0" },
        headers: { result: "*" },
        endFen: BLACK_MATES
      })
    ).toBeNull();
    expect(
      boardResultPatch({ gameOutcome: null, headers: { result: "*" }, endFen: START })
    ).toBeNull();
  });
});
