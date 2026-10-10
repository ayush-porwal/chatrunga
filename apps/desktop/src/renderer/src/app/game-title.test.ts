import { describe, expect, it } from "vitest";
import { decidedResult, gameModeLabel, gamePlayerNames } from "./game-title";

describe("game title helpers", () => {
  it("labels the game by mode, then by source", () => {
    expect(gameModeLabel({ mode: "engine", source: "new" })).toBe("Engine game");
    expect(gameModeLabel({ mode: "freeplay", source: "puzzle" })).toBe("Puzzle");
    // The origin names a game being analysed; one made for analysis reads "Analysis".
    expect(gameModeLabel({ mode: "analysis", source: "pgn-import" })).toBe("Imported game");
    expect(gameModeLabel({ mode: "freeplay", source: "chesscom", analysisBoard: true })).toBe(
      "Chess.com game"
    );
    expect(gameModeLabel({ mode: "analysis", source: "new" })).toBe("Analysis");
    expect(gameModeLabel({ mode: "freeplay", source: "new", analysisBoard: true })).toBe(
      "Analysis"
    );
    expect(gameModeLabel({ mode: "freeplay", source: "analysis" })).toBe("Analysis");
    expect(gameModeLabel({ mode: "freeplay", source: "pgn-import" })).toBe("Imported game");
    expect(gameModeLabel({ mode: "freeplay", source: "new" })).toBe("Free board");
  });

  it("names players, using the engine name and 'You' in an engine game", () => {
    expect(gamePlayerNames({ headers: {}, mode: "freeplay", engineSide: null }, null)).toBeNull();
    expect(
      gamePlayerNames({ headers: { white: "Morphy" }, mode: "freeplay", engineSide: null }, null)
    ).toEqual({ white: "Morphy", black: "Black" });
    expect(
      gamePlayerNames({ headers: {}, mode: "engine", engineSide: "black" }, "Stockfish")
    ).toEqual({ white: "You", black: "Stockfish" });
  });

  it("shows engines by their plain name, never with the managed marker", () => {
    // The engine of a game being played.
    expect(
      gamePlayerNames({ headers: {}, mode: "engine", engineSide: "white" }, "Stockfish (managed)")
    ).toEqual({ white: "Stockfish", black: "You" });
    // A name saved by an older build.
    expect(
      gamePlayerNames(
        {
          headers: { white: "You", black: "Maia 1500 (managed)" },
          mode: "freeplay",
          engineSide: null
        },
        null
      )
    ).toEqual({ white: "You", black: "Maia 1500" });
  });

  it("treats '*' as undecided", () => {
    expect(decidedResult("1-0")).toBe("1-0");
    expect(decidedResult("*")).toBeNull();
    expect(decidedResult(null)).toBeNull();
  });
});
