import { describe, expect, it } from "vitest";
import { uniformRatings } from "@chaturanga/shared/types/ratings";
import {
  engineGameHeaders,
  isMaiaPlayer,
  maiaGameRatings,
  playMaiaRating,
  savedMaiaRating,
  yourRating
} from "./engine-game";

/** Rapid 1640, blitz 1310, the other modes 1500. */
const ratings = {
  ...uniformRatings(1500),
  rapid: { source: "manual" as const, rating: 1640 },
  blitz: { source: "manual" as const, rating: 1310 }
};

describe("Maia's rating in Play", () => {
  it("is the rating last chosen, else yours for the clock's mode, else 1500, on Maia's grid", () => {
    expect(playMaiaRating({ saved: 2100, ratings, timeControl: "300+3" })).toBe(2100);
    expect(playMaiaRating({ saved: null, ratings, timeControl: "300+3" })).toBe(1300);
    // No clock counts as rapid.
    expect(playMaiaRating({ saved: null, ratings, timeControl: "-" })).toBe(1600);
    expect(playMaiaRating({ saved: undefined, ratings: undefined, timeControl: "-" })).toBe(1500);
    // Within Maia's range.
    const strong = { ...ratings, rapid: { source: "manual" as const, rating: 2950 } };
    expect(playMaiaRating({ saved: null, ratings: strong, timeControl: "900+10" })).toBe(2600);
  });

  it("reads your rating for the clock's mode as it is (not on Maia's grid)", () => {
    expect(yourRating(ratings, "300+3")).toBe(1310);
    expect(yourRating(ratings, "-")).toBe(1640);
    expect(yourRating(undefined, "-")).toBeNull();
  });
});

describe("a new engine game's headers", () => {
  const stockfish = { id: "sf", name: "Stockfish (managed)" };
  const maia = { id: "maia", name: "Maia (managed)" };
  const clock = { initialMs: 300_000, incrementMs: 3000 };

  it("names the engine's side and the clock, without ratings", () => {
    expect(
      engineGameHeaders({ engine: stockfish, engineColor: "black", clock, maia: null })
    ).toStrictEqual({
      event: "Casual game",
      site: "?",
      result: "*",
      timeControl: "300+3",
      white: "You",
      black: "Stockfish",
      whiteElo: null,
      blackElo: null,
      engineId: "sf"
    });
  });

  it("names Maia with its rating, and writes its rating and yours to the Elo tags", () => {
    const headers = engineGameHeaders({
      engine: maia,
      engineColor: "white",
      clock: null,
      maia: { rating: 1700, yourRating: 1640 }
    });
    expect(headers).toMatchObject({
      timeControl: "-",
      white: "Maia 1700",
      black: "You",
      whiteElo: "1700",
      blackElo: "1640",
      engineId: "maia"
    });
    expect(
      engineGameHeaders({
        engine: maia,
        engineColor: "black",
        clock,
        maia: { rating: 900, yourRating: null }
      })
    ).toMatchObject({ white: "You", black: "Maia 900", whiteElo: null, blackElo: "900" });
  });
});

describe("Maia's rating in a saved game", () => {
  it("reads Maia's Elo tag, else the rating in its name (Maia 1 games too), else 1500", () => {
    expect(savedMaiaRating({ white: "Maia 1700", black: "You", whiteElo: "1700" }, "white")).toBe(
      1700
    );
    // The tag wins over the name, and lands on Maia's grid.
    expect(savedMaiaRating({ white: "Maia 1700", black: "You", whiteElo: "1840" }, "white")).toBe(
      1800
    );
    expect(savedMaiaRating({ white: "You", black: "Maia 1300 (managed)" }, "black")).toBe(1300);
    expect(savedMaiaRating({ white: "You", black: "Maia" }, "black")).toBe(1500);
    expect(savedMaiaRating({ white: "You", black: "Maia 1100", blackElo: "?" }, "black")).toBe(
      1100
    );
  });

  it("plays against your Elo tag, else your rating for the game's clock, else 1500", () => {
    const game = {
      white: "Maia 1900",
      black: "You",
      whiteElo: "1900",
      blackElo: "1712",
      timeControl: "300+3"
    };
    expect(maiaGameRatings(game, "white", ratings)).toStrictEqual({
      rating: 1900,
      opponentRating: 1700
    });
    const legacy = { white: "Maia 1500 (managed)", black: "You", timeControl: "300+3" };
    expect(maiaGameRatings(legacy, "white", ratings)).toStrictEqual({
      rating: 1500,
      opponentRating: 1300
    });
    expect(maiaGameRatings(legacy, "white", undefined)).toStrictEqual({
      rating: 1500,
      opponentRating: 1500
    });
  });

  it("knows Maia's player names", () => {
    expect(isMaiaPlayer("Maia 1500")).toBe(true);
    expect(isMaiaPlayer("Maia 1900 (managed)")).toBe(true);
    expect(isMaiaPlayer("Maia")).toBe(false);
    expect(isMaiaPlayer("Stockfish")).toBe(false);
    expect(isMaiaPlayer(null)).toBe(false);
  });
});
