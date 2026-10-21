import { describe, expect, it } from "vitest";
import type { GameReview, MoveReview, RatingPrediction } from "@chaturanga/shared/types/engine";
import { MAIA3_RATINGS } from "@chaturanga/shared/engine/maia3";
import { curveRequest, maiaCurveSource, markedRating } from "./maia-curve-source";
import { humanMoveRows, tablePrediction } from "./rating-curve-chart";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

/** 1. e4 (White's move), or with `fenBefore` 1… of Black's. */
function move(overrides: Partial<MoveReview> = {}): MoveReview {
  return {
    nodeId: "n1",
    ply: 1,
    san: "e4",
    playedMove: "e2e4",
    fenBefore: START,
    fenAfter: AFTER_E4,
    evalBefore: { type: "cp", value: 20 },
    evalAfter: { type: "cp", value: 20 },
    evalLoss: 0,
    bestMove: "e2e4",
    bestLine: ["e2e4"],
    topLines: [],
    motifs: [],
    ...overrides
  };
}

const blackMove = () =>
  move({ nodeId: "n2", ply: 2, san: "e5", playedMove: "e7e5", fenBefore: AFTER_E4 });

/** Maia 3's curve over its 21 ratings after 1. e4: Nf6 likelier than e5 above 1500. */
const curve = (): RatingPrediction[] =>
  MAIA3_RATINGS.map((rating) => ({
    rating,
    // Likeliest first, as Maia lists them.
    topMoves:
      rating > 1500
        ? [
            { uci: "g8f6", prob: 0.4 },
            { uci: "e7e5", prob: 0.3 }
          ]
        : [
            { uci: "e7e5", prob: 0.5 },
            { uci: "g8f6", prob: 0.2 }
          ]
  }));

const maia3: GameReview["maia"] = {
  model: "maia3",
  modelVersion: "maia3_simplified@0013cc8",
  white: { rating: 1400, source: "game" },
  black: { rating: 1720, source: "game" }
};

describe("maiaCurveSource", () => {
  it("is a saved Maia 3 review's id and the rating it read each side at", () => {
    expect(maiaCurveSource("g1", { reviewId: "r1", maia: maia3 })).toStrictEqual({
      gameId: "g1",
      reviewId: "r1",
      ratings: { white: 1400, black: 1720 }
    });
  });

  it("is null for a review that isn't saved, or wasn't read with Maia 3", () => {
    expect(maiaCurveSource(null, { reviewId: "r1", maia: maia3 })).toBeNull();
    expect(maiaCurveSource("g1", { reviewId: undefined, maia: maia3 })).toBeNull();
    expect(maiaCurveSource("g1", { reviewId: "r1" })).toBeNull();
    expect(maiaCurveSource("g1", null)).toBeNull();
  });
});

describe("a Maia 3 review's moves, a partial run's missed ones too", () => {
  const source = maiaCurveSource("g1", { reviewId: "r1", maia: maia3 });

  it("asks for the curve of every move without one, whether Maia read it or not", () => {
    const read = move({ moverPrediction: { rating: 1400, topMoves: [] } });
    const expected = { gameId: "g1", reviewId: "r1", nodeId: "n1" };
    expect(curveRequest(source, read, false)).toStrictEqual(expected);
    // Missed by the run (no prediction of its own): asked for all the same.
    expect(curveRequest(source, move(), false)).toStrictEqual(expected);
    // Saved with the move already, or not a saved Maia 3 review: nothing to ask.
    expect(curveRequest(source, move(), true)).toBeNull();
    expect(curveRequest(null, move(), false)).toBeNull();
  });

  it("reads the mover at their own prediction's rating, else their side's rating in the review", () => {
    const read = move({ moverPrediction: { rating: 1450, topMoves: [] } });
    expect(markedRating(read, source, 2000)).toBe(1450);
    // Missed: White's 1400; Black's 1720 at the curve's nearest point, 1700.
    expect(markedRating(move(), source, 2000)).toBe(1400);
    expect(markedRating(blackMove(), source, 2000)).toBe(1700);
    // Maia 1: the user's nearest level.
    expect(markedRating(move(), null, 1580)).toBe(1500);
  });

  it("lists a missed move's Human moves from its curve at the mover's rating", () => {
    const missed = { ...blackMove(), humanPredictions: curve() };
    const marked = markedRating(missed, source, 1000);
    const prediction = tablePrediction(missed, marked);
    expect(prediction?.rating).toBe(1700);
    expect(humanMoveRows(missed, prediction).map((row) => row.san)).toStrictEqual(["Nf6", "e5"]);
    // Before the curve is read there is nothing to list.
    expect(tablePrediction(blackMove(), marked)).toBeUndefined();
  });
});
