import { describe, expect, it } from "vitest";
import { cardOf } from "./__fixtures__/repertoire";
import { positionLine, sessionCounts, sessionHeading } from "./practice-session-model";

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

describe("the practice panel's position line", () => {
  it("reads the lead-up and ends on the move to find", () => {
    const leadUp = [
      { san: "e4", uci: "e2e4", fen: "" },
      { san: "c5", uci: "c7c5", fen: "" }
    ];
    const afterC5 = "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    expect(positionLine({ fen: afterC5, leadUp })).toBe("1. e4 c5 2. ?");
    const afterE4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    expect(positionLine({ fen: afterE4, leadUp: leadUp.slice(0, 1) })).toBe("1. e4 ?");
    // A chapter starting at Black's move numbers it.
    expect(positionLine({ fen: afterE4, leadUp: [] })).toBe("1… ?");
  });
});
