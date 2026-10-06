import { describe, expect, it } from "vitest";
import type { MoveAnnotation, MoveAssessment, MoveReview } from "../types/engine";
import { keyMoments, momentWeight, rankedMoments } from "./key-moments";
import { assessMoves } from "./move-assessment";
import { trapReviewMoves } from "./__fixtures__/trap-game";

function assessment(
  annotation: MoveAnnotation | null,
  overrides: Partial<MoveAssessment> = {}
): MoveAssessment {
  const severity =
    annotation === "inaccuracy" || annotation === "mistake" || annotation === "blunder"
      ? annotation
      : null;
  return {
    policy: 1,
    winBefore: 50,
    winAfter: 50,
    winLoss: 0,
    alternativeGap: null,
    severity,
    annotation,
    tags: [],
    ...overrides
  };
}

/** Moves at the given plies with the given assessments (the rest of the move doesn't matter here). */
function moves(items: readonly [number, MoveAssessment][]): MoveReview[] {
  return items.map(([ply, item]) => ({
    nodeId: `n${ply}`,
    ply,
    san: "e4",
    playedMove: "e2e4",
    fenBefore: "",
    fenAfter: "",
    evalBefore: null,
    evalAfter: null,
    evalLoss: null,
    bestMove: null,
    bestLine: [],
    topLines: [],
    motifs: [],
    assessment: item
  }));
}

/** The trap game, assessed as a live review would (Qg5 confirmed by a deeper search). */
function trapGame(): MoveReview[] {
  const game = trapReviewMoves().map((move, index) =>
    index === 7 ? { ...move, verification: { deeperLines: move.topLines } } : move
  );
  const assessments = assessMoves(game);
  return game.map((move, index) => ({ ...move, assessment: assessments[index] }));
}

describe("key moments", () => {
  it.each([
    [assessment("blunder", { winLoss: 32 }), 32],
    [assessment("blunder", { winLoss: 2.5 }), 15],
    [assessment("mistake", { winLoss: 2.5 }), 10],
    [assessment("inaccuracy", { winLoss: 9 }), 4.5],
    [assessment("miss", { severity: "blunder", winLoss: 20 }), 25],
    [assessment("miss", { severity: null, winLoss: 0 }), 15],
    [assessment("brilliant", { alternativeGap: 4 }), 29],
    [assessment("great", { alternativeGap: 17.8 }), 17.8],
    [assessment("great", { alternativeGap: null }), 10],
    [assessment("excellent", { alternativeGap: 8 }), 6],
    [assessment("good"), 5],
    [assessment("book", { winLoss: 30 }), null],
    [assessment(null), null]
  ])("weighs %o as %s", (item, weight) => {
    expect(momentWeight(item)).toBe(weight);
  });

  it("never makes a book move a moment", () => {
    const game = moves([
      [1, assessment("book")],
      [2, assessment("book", { winLoss: 40 })],
      [3, assessment("inaccuracy", { winLoss: 6 })]
    ]);
    expect(keyMoments(game).map((moment) => moment.ply)).toEqual([3]);
  });

  it("leads the trap game with its blunders, the critical reply and the mate allowed", () => {
    const game = trapGame();
    expect(keyMoments(game).map((moment) => [moment.ply, moment.annotation])).toEqual([
      [7, "blunder"],
      [8, "great"],
      [9, "blunder"],
      [13, "mistake"]
    ]);
  });

  it("takes one moment per sequence: a move and the reply to it are one lesson", () => {
    const game = moves([
      [10, assessment("blunder", { winLoss: 30 })],
      [11, assessment("miss", { severity: "mistake", winLoss: 12 })],
      [12, assessment("mistake", { winLoss: 11 })],
      [20, assessment("mistake", { winLoss: 12 })]
    ]);
    expect(keyMoments(game).map((moment) => moment.ply)).toEqual([10, 12, 20]);
  });

  it("starts with three and grows to five only with that many strong moments", () => {
    const strong = moves(
      [2, 6, 10, 14, 18, 22, 26].map((ply) => [ply, assessment("blunder", { winLoss: 20 + ply })])
    );
    expect(keyMoments(strong).map((moment) => moment.ply)).toEqual([10, 14, 18, 22, 26]);
    const weak = moves(
      [2, 6, 10, 14].map((ply) => [ply, assessment("inaccuracy", { winLoss: 5 + ply / 10 })])
    );
    expect(keyMoments(weak).map((moment) => moment.ply)).toEqual([6, 10, 14]);
    expect(keyMoments(moves([[4, assessment("mistake", { winLoss: 12 })]]))).toHaveLength(1);
    expect(keyMoments(moves([[4, assessment(null)]]))).toEqual([]);
    expect(keyMoments(strong, { min: 1, max: 2 }).map((moment) => moment.ply)).toEqual([22, 26]);
  });

  it("keeps the best success even when errors fill the summary", () => {
    const game = moves([
      ...[2, 6, 10, 14, 18].map((ply): [number, MoveAssessment] => [
        ply,
        assessment("blunder", { winLoss: 30 })
      ]),
      [30, assessment("excellent", { alternativeGap: 6 })],
      [31, assessment("good")]
    ]);
    const chosen = keyMoments(game);
    expect(chosen).toHaveLength(5);
    expect(chosen.map((moment) => moment.annotation)).toContain("excellent");
    expect(chosen.map((moment) => moment.annotation)).not.toContain("good");
  });

  it("ranks heaviest first, earlier first on ties", () => {
    const game = moves([
      [5, assessment("mistake", { winLoss: 12 })],
      [3, assessment("mistake", { winLoss: 12 })],
      [9, assessment("blunder", { winLoss: 40 })]
    ]);
    expect(rankedMoments(game).map((moment) => moment.ply)).toEqual([9, 3, 5]);
  });
});
