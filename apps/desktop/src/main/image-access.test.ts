import { describe, expect, it } from "vitest";
import { allowChosenFile, isServableImage } from "./image-access";

describe("isServableImage", () => {
  it("serves engine pictures and files picked this session, nothing else", () => {
    const registered = () => ["/engines/stockfish.png", null];
    expect(isServableImage("/engines/stockfish.png", registered)).toBe(true);
    expect(isServableImage("/Users/me/Pictures/private.png", registered)).toBe(false);
    allowChosenFile("/Users/me/Pictures/maia.png");
    expect(isServableImage("/Users/me/Pictures/maia.png", registered)).toBe(true);
  });
});
