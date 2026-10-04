import { describe, expect, it } from "vitest";
import { isUciMove, uciFromUserMove, userMoveFromUci, userMoveBetween } from "./uci";

describe("uci helpers", () => {
  it("recognises UCI moves", () => {
    expect(isUciMove("e2e4")).toBe(true);
    expect(isUciMove("e7e8q")).toBe(true);
    expect(isUciMove("Nf3")).toBe(false);
    expect(isUciMove("e7e8k")).toBe(false);
  });

  it("round-trips plain moves and promotions", () => {
    expect(userMoveFromUci("e2e4")).toEqual({ from: "e2", to: "e4", promotion: undefined });
    expect(userMoveFromUci("a7a8n")).toEqual({ from: "a7", to: "a8", promotion: "knight" });
    expect(userMoveFromUci("e2e9")).toBeNull();
    expect(userMoveBetween("e7", "e8", "queen")).toEqual({
      from: "e7",
      to: "e8",
      promotion: "queen"
    });
    expect(userMoveBetween("a0", "e8")).toBeNull();
    expect(uciFromUserMove({ from: "e7", to: "e8", promotion: "queen" })).toBe("e7e8q");
    expect(uciFromUserMove({ from: "g1", to: "f3" })).toBe("g1f3");
  });
});
