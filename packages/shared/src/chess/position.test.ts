import { describe, expect, it } from "vitest";
import {
  START_FEN,
  applySan,
  applyUserMove,
  fenAfterUci,
  isPromotionMove,
  legalDestsForFen,
  moveFromUci,
  statusForFen
} from "./position";

describe("position helpers", () => {
  it("applies legal UCI, user, and SAN moves", () => {
    expect(fenAfterUci(START_FEN, "e2e4")).toContain(" b ");
    expect(applyUserMove(START_FEN, { from: "e2", to: "e4" })).toMatchObject({
      san: "e4",
      uci: "e2e4"
    });
    expect(applySan(START_FEN, "Nf3")).toMatchObject({ san: "Nf3", uci: "g1f3" });
  });

  it("rejects illegal moves", () => {
    expect(fenAfterUci(START_FEN, "e2e5")).toBeNull();
    expect(applyUserMove(START_FEN, { from: "e2", to: "e5" })).toBeNull();
    expect(applySan(START_FEN, "Qh5")).toBeNull();
  });

  it("detects legal destinations and promotion candidates", () => {
    const dests = legalDestsForFen(START_FEN);
    expect(dests.get("e2")).toEqual(expect.arrayContaining(["e3", "e4"]));
    expect(isPromotionMove("8/P7/8/8/8/8/8/k6K w - - 0 1", "a7", "a8")).toBe(true);
    expect(isPromotionMove(START_FEN, "e2", "e4")).toBe(false);
  });

  it("reports terminal status", () => {
    expect(statusForFen(START_FEN)).toMatchObject({
      turn: "white",
      isCheck: false,
      isEnd: false,
      result: "*"
    });
    expect(statusForFen("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3"))
      .toMatchObject({
        isCheck: true,
        isCheckmate: true,
        result: "0-1"
      });
    expect(statusForFen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")).toMatchObject({
      isStalemate: true,
      result: "1/2-1/2"
    });
  });

  it("parses UCI moves", () => {
    expect(moveFromUci("e2e4")).toBeDefined();
    expect(moveFromUci("bad")).toBeUndefined();
  });
});
