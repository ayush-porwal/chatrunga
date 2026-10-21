import { describe, expect, it } from "vitest";
import { START_FEN } from "../chess/position";
import {
  clampMaia3Rating,
  MAIA3_RATINGS,
  maia3Prediction,
  nearestMaia3Rating,
  type Maia3Output
} from "./maia3";

const CASTLING_FEN = "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1";

describe("Maia 3 ratings", () => {
  it("lists 600 to 2600 in steps of 100", () => {
    expect(MAIA3_RATINGS).toHaveLength(21);
    expect(MAIA3_RATINGS[0]).toBe(600);
    expect(MAIA3_RATINGS.at(-1)).toBe(2600);
    expect(MAIA3_RATINGS.every((rating, index) => rating === 600 + index * 100)).toBe(true);
  });

  it("clamps to the range as a whole number, any integer allowed", () => {
    expect(clampMaia3Rating(1234.6)).toBe(1235);
    expect(clampMaia3Rating(100)).toBe(600);
    expect(clampMaia3Rating(3200)).toBe(2600);
    expect(clampMaia3Rating(Number.NaN)).toBe(1500);
  });

  it("snaps to the nearest grid point within the range, half-way up", () => {
    expect(nearestMaia3Rating(1449)).toBe(1400);
    expect(nearestMaia3Rating(1450)).toBe(1500);
    expect(nearestMaia3Rating(1533)).toBe(1500);
    expect(nearestMaia3Rating(320)).toBe(600);
    expect(nearestMaia3Rating(2890)).toBe(2600);
    expect(nearestMaia3Rating(Number.POSITIVE_INFINITY)).toBe(1500);
  });
});

describe("maia3Prediction", () => {
  const output: Maia3Output = {
    policy: { e2e4: 0.41234, d2d4: 0.3, g1f3: 0.15, c2c4: 0.1, b1c3: 0.03, a2a3: 0.00766 },
    value: 0.5312
  };

  it("keeps the top five moves, the played and best moves' odds and White's chances", () => {
    expect(
      maia3Prediction({ output, fen: START_FEN, rating: 1500, playedUci: "a2a3", bestUci: "d2d4" })
    ).toStrictEqual({
      rating: 1500,
      topMoves: [
        { uci: "e2e4", prob: 0.4123 },
        { uci: "d2d4", prob: 0.3 },
        { uci: "g1f3", prob: 0.15 },
        { uci: "c2c4", prob: 0.1 },
        { uci: "b1c3", prob: 0.03 }
      ],
      playedProb: 0.0077,
      playedRank: 6,
      bestProb: 0.3,
      bestRank: 2,
      whiteWinProb: 0.5312
    });
  });

  it("ranks the full policy even when it arrives unsorted, and keeps as many moves as asked", () => {
    const prediction = maia3Prediction({
      output: { policy: { d2d4: 0.2, e2e4: 0.8 }, value: 0.5 },
      fen: START_FEN,
      rating: 900,
      playedUci: "e2e4",
      bestUci: null,
      topMoves: 1
    });
    expect(prediction.topMoves).toStrictEqual([{ uci: "e2e4", prob: 0.8 }]);
    expect(prediction).toMatchObject({ playedProb: 0.8, playedRank: 1 });
    expect(prediction.bestProb).toBeUndefined();
  });

  it("prices a move Maia didn't list at 0, without a rank", () => {
    const prediction = maia3Prediction({
      output,
      fen: START_FEN,
      rating: 1500,
      playedUci: "h2h4",
      bestUci: "h2h3"
    });
    expect(prediction.playedProb).toBe(0);
    expect(prediction.playedRank).toBeUndefined();
    expect(prediction.bestProb).toBeUndefined();
    expect(prediction.bestRank).toBeUndefined();
  });

  it("compares castling in standard UCI whichever way the move is written", () => {
    const prediction = maia3Prediction({
      output: { policy: { e1g1: 0.6, e1c1: 0.4 }, value: 0.5 },
      fen: CASTLING_FEN,
      rating: 1500,
      playedUci: "e1h1",
      bestUci: "e1a1"
    });
    expect(prediction).toMatchObject({
      playedRank: 1,
      playedProb: 0.6,
      bestRank: 2,
      bestProb: 0.4
    });
  });
});
