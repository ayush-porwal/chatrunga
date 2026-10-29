import { describe, expect, it } from "vitest";
import { cardOf } from "./__fixtures__/repertoire";
import { sessionCounts, sessionHeading } from "./practice-session-model";

describe("practice session counters and heading", () => {
  it("counts due and new cards left, cards done and the share right (first sights aside)", () => {
    const cards = [
      cardOf("a", { state: "answered-correct" }),
      cardOf("b", { state: "answered-wrong" }),
      cardOf("c", { stage: "new", state: "answered-correct", preview: { uci: "e2e4" } }),
      cardOf("d"),
      cardOf("e", { stage: "new" }),
      cardOf("f", { state: "skipped" })
    ];
    expect(sessionCounts(cards)).toStrictEqual({ due: 1, fresh: 1, done: 4, right: 50 });
    expect(sessionCounts([cardOf("a")]).right).toBeNull();
  });

  it("heads a card with its kind, repertoire and chapter, or its weak spot", () => {
    const where = { repertoire: "Caro-Kann (Black)", chapter: "Advance Variation" };
    const review = cardOf("a");
    expect(sessionHeading({ mode: "review-due", cards: [review] }, review, where)).toBe(
      "Review · Caro-Kann (Black) · Advance Variation"
    );
    expect(sessionHeading({ mode: "practice-early", cards: [review] }, review, where)).toBe(
      "Practice early · Caro-Kann (Black) · Advance Variation"
    );
    const spots = [cardOf("a", { weakGames: 49 }), cardOf("b", { weakGames: 1 }), cardOf("c")];
    expect(sessionHeading({ mode: "weak", cards: spots }, spots[1], where)).toBe(
      "Weak spot 2 of 2 · seen in 1 game"
    );
    expect(sessionHeading({ mode: "weak", cards: spots }, spots[2], where)).toBe(
      "Lines you meet most · Caro-Kann (Black)"
    );
  });
});
