import { describe, expect, it } from "vitest";
import { START_FEN } from "@chaturanga/shared/chess/position";
import { afterBookLoss, bestRecord, reviewedMoves, shownOutcome } from "./outcomes";

const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

/** A reviewed move at `ply` with side-to-move scores before and after it. */
function move(ply: number, before: number | null, after: number | null) {
  // Odd plies are White's: the position before has White to move.
  const white = ply % 2 === 1;
  return {
    ply,
    fenBefore: white ? START_FEN : AFTER_E4,
    fenAfter: white ? AFTER_E4 : START_FEN,
    evalBefore: before === null ? null : { type: "cp", value: before },
    evalAfter: after === null ? null : { type: "cp", value: after }
  };
}

describe("afterBookLoss", () => {
  it("is the user's win-% before leaving book minus 10 plies later", () => {
    const moves = reviewedMoves({
      moves: [
        move(5, 0, 0),
        ...[6, 7, 8, 9, 10, 11, 12, 13].map((ply) => move(ply, 0, 0)),
        move(14, 0, 300)
      ]
    });
    // White left book at ply 5, even; at ply 14 (Black's move) White is to move at +3.
    const loss = afterBookLoss(moves, 5, "white");
    expect(loss).toBeLessThan(-20);
    expect(afterBookLoss(moves, 5, "black")).toBeCloseTo(-loss!, 6);
  });

  it("reads the last reviewed move before the tenth ply, and nothing without evaluations", () => {
    const short = reviewedMoves({ moves: [move(5, 0, 0), move(6, 0, -200)] });
    expect(afterBookLoss(short, 5, "white")).toBeGreaterThan(0);
    expect(afterBookLoss(reviewedMoves({ moves: [move(5, null, 0)] }), 5, "white")).toBeNull();
    expect(reviewedMoves({ moves: [{ ply: "5" }, null] })).toStrictEqual([]);
    expect(reviewedMoves(null)).toStrictEqual([]);
  });
});

describe("bestRecord", () => {
  it("takes the repertoire followed longest, ties to the first created", () => {
    const created: Record<string, number> = { a: 2, b: 1 };
    const at = (id: string) => created[id];
    expect(
      bestRecord(
        [
          { repertoireId: "a", matchedPlies: 4 },
          { repertoireId: "b", matchedPlies: 6 }
        ],
        at
      )
    ).toStrictEqual({ repertoireId: "b", matchedPlies: 6 });
    expect(
      bestRecord(
        [
          { repertoireId: "a", matchedPlies: 3 },
          { repertoireId: "b", matchedPlies: 3 }
        ],
        at
      )?.repertoireId
    ).toBe("b");
  });
});

describe("shownOutcome", () => {
  it("counts a slip or a reply at either side's first move as another opening", () => {
    const at = (outcome: "forgot" | "new-reply", ply: number) =>
      shownOutcome({ outcome, ply, rootFen: START_FEN });
    expect(at("forgot", 1)).toBe("not-covered");
    expect(at("new-reply", 2)).toBe("not-covered");
    expect(at("forgot", 3)).toBe("forgot");
    expect(at("new-reply", 4)).toBe("new-reply");
  });
});
