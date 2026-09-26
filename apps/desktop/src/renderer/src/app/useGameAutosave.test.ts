import { describe, expect, it } from "vitest";
import { savedResult } from "./useGameAutosave";

describe("savedResult", () => {
  it("prefers the outcome of a finished game, then a terminal position", () => {
    expect(savedResult("0-1", "*", "1-0")).toBe("0-1");
    expect(savedResult(undefined, "1-0", "*")).toBe("1-0");
  });

  it("keeps a decided game's recorded result while the board shows a position mid-game", () => {
    expect(savedResult(undefined, "*", "1-0")).toBe("1-0");
  });

  it("reads an undecided game as in progress", () => {
    expect(savedResult(undefined, "*", "*")).toBe("*");
    expect(savedResult(undefined, "*", null)).toBe("*");
    expect(savedResult(undefined, "*", undefined)).toBe("*");
  });
});
