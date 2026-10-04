import { describe, expect, it } from "vitest";
import type { MaiaRating, RatingPrediction } from "../types/engine";
import { bestMoveChance, difficultyModel, maiaDifficulty } from "./maia-difficulty";

function prediction(rating: MaiaRating, extra: Partial<RatingPrediction> = {}): RatingPrediction {
  return {
    rating,
    topMoves: [
      { uci: "e2e4", prob: 0.6 },
      { uci: "d2d4", prob: 0.3 }
    ],
    ...extra
  };
}

describe("Maia difficulty", () => {
  it("is 1 minus Maia's chance of the engine's best move at the model", () => {
    const move = {
      bestMove: "d2d4",
      humanPredictions: [prediction(1100, { bestProb: 0.12 }), prediction(1500, { bestProb: 0.4 })]
    };
    expect(bestMoveChance(move, 1100)).toBe(0.12);
    expect(maiaDifficulty(move, 1100)).toBeCloseTo(0.88);
    expect(maiaDifficulty(move, 1500)).toBeCloseTo(0.6);
  });

  it("reads the best move from Maia's top moves when the review kept no best-move chance", () => {
    expect(maiaDifficulty({ bestMove: "d2d4", humanPredictions: [prediction(1500)] }, 1500)).toBe(
      0.7
    );
    expect(maiaDifficulty({ bestMove: "g2g4", humanPredictions: [prediction(1500)] }, 1500)).toBe(
      null
    );
  });

  it("has none without a best move or a prediction at the model", () => {
    expect(maiaDifficulty({ bestMove: null, humanPredictions: [prediction(1500)] }, 1500)).toBe(
      null
    );
    expect(maiaDifficulty({ bestMove: "e2e4", humanPredictions: [prediction(1100)] }, 1500)).toBe(
      null
    );
    expect(maiaDifficulty({ bestMove: "e2e4" }, 1500)).toBe(null);
  });

  it("reads the review's own model, else the one nearest the rating that the moves carry", () => {
    const moves = [{ humanPredictions: [prediction(1100), prediction(1500)] }, {}];
    expect(difficultyModel(moves, 1500, 1100)).toBe(1500);
    expect(difficultyModel(moves, 1900, 1800)).toBe(1500);
    expect(difficultyModel(moves, null, 1300)).toBe(1100);
    expect(difficultyModel(moves, null, 1000)).toBe(1100);
    expect(difficultyModel([{}, { humanPredictions: [] }], 1500, 1500)).toBe(null);
  });
});
