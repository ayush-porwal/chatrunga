import { describe, expect, it } from "vitest";
import { decidedResult, gameModeLabel, gamePlayerNames, resultBadgeLabel } from "./game-title";

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

  it("labels the result badge with how the game ended, when that is known", () => {
    expect(resultBadgeLabel("1-0", "Player resign")).toBe("1-0 · Resignation");
    expect(resultBadgeLabel("0-1", "Time forfeit")).toBe("0-1 · On time");
    expect(resultBadgeLabel("1/2-1/2", "Draw by agreement")).toBe("1/2-1/2 · Agreement");
    expect(resultBadgeLabel("1-0", "checkmate")).toBe("1-0 · Checkmate");
    // Chess.com's sentence names the winner: only how the game ended is kept.
    expect(resultBadgeLabel("0-1", "pawnstorm99 won by checkmate")).toBe("0-1 · Checkmate");
    expect(resultBadgeLabel("1-0", "kakashi won by resignation")).toBe("1-0 · Resignation");
    expect(resultBadgeLabel("1-0", "kakashi won on time")).toBe("1-0 · On time");
    expect(resultBadgeLabel("1/2-1/2", "Game drawn by repetition")).toBe("1/2-1/2 · Repetition");
    expect(resultBadgeLabel("1/2-1/2", "Game drawn by timeout vs insufficient material")).toBe(
      "1/2-1/2 · Timeout vs insufficient material"
    );
    expect(resultBadgeLabel("1-0", "kakashi won")).toBe("1-0");
    // Unknown, or a tag that doesn't say how (Lichess's "Normal"): the result alone.
    expect(resultBadgeLabel("1-0", null)).toBe("1-0");
    expect(resultBadgeLabel("1-0", "Normal")).toBe("1-0");
    // Undecided: no badge.
    expect(resultBadgeLabel("*", "Player resign")).toBeNull();
    expect(resultBadgeLabel(null, null)).toBeNull();
  });
});
