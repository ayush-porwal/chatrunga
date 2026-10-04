import { describe, expect, it } from "vitest";
import { isSquare, uciSquares } from "./square";

describe("isSquare", () => {
  it("accepts board squares only", () => {
    expect(["a1", "e4", "h8"].every(isSquare)).toBe(true);
    expect(["a0", "i1", "e9", "E4", "e4 ", ""].some(isSquare)).toBe(false);
  });
});

describe("uciSquares", () => {
  it("splits a UCI move into its squares, ignoring a promotion", () => {
    expect(uciSquares("e2e4")).toEqual(["e2", "e4"]);
    expect(uciSquares("e7e8q")).toEqual(["e7", "e8"]);
  });

  it("is null for text that doesn't start with two squares", () => {
    expect(uciSquares("")).toBeNull();
    expect(uciSquares("e2")).toBeNull();
    expect(uciSquares("a0e4")).toBeNull();
    expect(uciSquares("O-O")).toBeNull();
  });
});
