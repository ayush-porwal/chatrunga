import { describe, expect, it } from "vitest";
import { savedEngineMatch } from "./rejoin-saved-game";

const stockfish = { id: "sf", name: "Stockfish (managed)", isAvailable: true };
const maia = { id: "m15", name: "Maia 1500 (managed)", isAvailable: false };

describe("rejoining a saved engine game", () => {
  it("plays on against the installed engine named in the game, as the side you had", () => {
    expect(savedEngineMatch({ white: "You", black: "Stockfish" }, [maia, stockfish])).toEqual({
      engine: stockfish,
      engineSide: "black",
      humanSide: "white"
    });
    // Saved by an older build with the managed marker in the name.
    expect(
      savedEngineMatch({ white: "Stockfish (managed)", black: "You" }, [stockfish])
    ).toMatchObject({ engine: stockfish, engineSide: "white", humanSide: "black" });
  });

  it("only opens the game when its engine is missing or unavailable, or the sides are unclear", () => {
    expect(savedEngineMatch({ white: "You", black: "Komodo" }, [stockfish])).toBeNull();
    expect(savedEngineMatch({ white: "Maia 1500", black: "You" }, [maia])).toBeNull();
    expect(savedEngineMatch({ white: "Alpha", black: "Stockfish" }, [stockfish])).toBeNull();
    expect(savedEngineMatch({ white: "You", black: "You" }, [stockfish])).toBeNull();
    expect(savedEngineMatch({ white: "You", black: "" }, [stockfish])).toBeNull();
  });
});
