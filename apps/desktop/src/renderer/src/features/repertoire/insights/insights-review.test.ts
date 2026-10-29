import { describe, expect, it } from "vitest";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { insightsReviewText } from "./InsightsReviewNotice";
import type { InsightsReviewFocus } from "./insights-return";
import { insightsDecisionShapes } from "./insights-review";

/** 1.e4 c5 2.d4: White left the repertoire (2.Nf3) at ply 3. */
const tree = [
  { id: "root", parentId: null, uci: null, ply: 0, children: ["a"] },
  { id: "a", parentId: "root", uci: "e2e4", ply: 1, children: ["b"] },
  { id: "b", parentId: "a", uci: "c7c5", ply: 2, children: ["c"] },
  { id: "c", parentId: "b", uci: "d2d4", ply: 3, children: [] }
] as unknown as MoveNode[];

const forgot: InsightsReviewFocus = {
  outcome: "forgot",
  repertoireId: "r",
  repertoireName: "Sicilian",
  color: "white",
  issue: {
    ply: 3,
    played: "d4",
    playedUci: "d2d4",
    expected: ["Nf3"],
    expectedUcis: ["g1f3"],
    positionKey: "k",
    study: null
  }
};

describe("Game review's From your games band", () => {
  it("says what the game did at the move it left the repertoire", () => {
    expect(insightsReviewText(forgot)).toBe(
      "You left “Sicilian” here: you played 2.d4, but it has 2.Nf3."
    );
    expect(
      insightsReviewText({
        ...forgot,
        outcome: "new-reply",
        issue: { ...forgot.issue!, ply: 4, played: "e5", expected: [], expectedUcis: [] }
      })
    ).toBe("Your opponent played 2…e5 here, which “Sicilian” doesn't answer yet.");
    expect(insightsReviewText({ ...forgot, outcome: "no-repertoire", issue: null })).toBe(
      "You have no White repertoire to compare this game with."
    );
  });

  it("draws the repertoire's move and the one played only at that position", () => {
    expect(insightsDecisionShapes(forgot, tree, "b")).toStrictEqual([
      { orig: "g1", dest: "f3", brush: "green" },
      { orig: "d2", dest: "d4", brush: "red" }
    ]);
    expect(insightsDecisionShapes(forgot, tree, "c")).toStrictEqual([]);
    expect(insightsDecisionShapes(null, tree, "b")).toStrictEqual([]);
  });
});
