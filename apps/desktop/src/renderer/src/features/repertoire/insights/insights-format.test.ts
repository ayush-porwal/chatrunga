import { describe, expect, it } from "vitest";
import { START_FEN } from "@chaturanga/shared/chess/position";
import type { InsightsUnpreparedReply } from "@chaturanga/shared/types/repertoire-insights";
import { prepareStudyTarget } from "./insights-actions";
import {
  afterBookText,
  lineLabels,
  outcomeFilterIndex,
  outcomePill,
  plyMoveLabel
} from "./insights-format";

describe("Insights words", () => {
  it("numbers moves by their ply", () => {
    expect(plyMoveLabel(5, "e5")).toBe("3.e5");
    expect(plyMoveLabel(8, "Nc6")).toBe("4…Nc6");
    expect(
      lineLabels(START_FEN, [
        { uci: "e2e4", san: "e4" },
        { uci: "c7c6", san: "c6" },
        { uci: "d2d4", san: "d4" }
      ])
    ).toStrictEqual(["1. e4", "c6", "2. d4"]);
  });

  it("says what happened in a game on its outcome pill", () => {
    expect(
      outcomePill({
        outcome: "forgot",
        color: "black",
        issue: { ply: 8, played: "Nf6", expected: ["Nc6"] }
      })
    ).toMatchObject({ label: "Forgot 4…Nc6", title: "You played 4…Nf6; your repertoire has Nc6." });
    expect(
      outcomePill({
        outcome: "new-reply",
        color: "black",
        issue: { ply: 5, played: "e5", expected: [] }
      }).label
    ).toBe("New reply 3.e5");
    expect(
      outcomePill({
        outcome: "not-covered",
        color: "white",
        issue: { ply: 1, played: "e3", expected: [] }
      }).label
    ).toBe("Not covered: 1.e3");
    expect(outcomePill({ outcome: "no-repertoire", color: "white", issue: null }).label).toBe(
      "No White repertoire"
    );
  });

  it("writes the after-book loss with its sign", () => {
    expect(afterBookText({ averageLoss: 12.4, reviewedGames: 5 })?.text).toBe("−12% after");
    expect(afterBookText({ averageLoss: -3, reviewedGames: 1 })?.text).toBe("+3% after");
    expect(afterBookText(null)).toBeNull();
  });

  it("finds a bar segment's outcomes among the games list's choices", () => {
    expect(outcomeFilterIndex(null)).toBe(0);
    expect(outcomeFilterIndex(["in-book", "ended-in-book"])).toBeGreaterThan(0);
  });
});

describe("Prepare", () => {
  it("opens Study before the reply, staged, with the From your games banner", () => {
    const reply: InsightsUnpreparedReply = {
      repertoireId: "r",
      repertoireName: "Caro-Kann",
      color: "black",
      positionKey: "k",
      fen: START_FEN,
      games: 32,
      rootFen: START_FEN,
      line: [],
      score: { wins: 1, draws: 0, losses: 0, percent: 100 },
      lastSeenAt: null,
      afterBook: null,
      latestGameId: "g",
      ply: 1,
      study: { chapterId: "c", nodeId: "n" },
      reply: { uci: "e2e4", san: "e4" }
    };
    expect(prepareStudyTarget(reply)).toStrictEqual({
      repertoireId: "r",
      chapterId: "c",
      nodeId: "n",
      tab: "moves",
      stage: { nodeId: "n", uci: "e2e4" },
      fromGames: {
        kind: "unprepared",
        positionKey: "k",
        reply: { uci: "e2e4", san: "e4", games: 32 }
      }
    });
  });
});
