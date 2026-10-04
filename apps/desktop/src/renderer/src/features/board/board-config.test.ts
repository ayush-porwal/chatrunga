import { describe, expect, it } from "vitest";
import { restoreBoardConfig } from "./board-config";
import { isOneMoveApart, isSingleStep } from "./board-motion";

describe("restoreBoardConfig", () => {
  const fen = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1";

  it("gives the move back to the side to move, with its legal moves, after a rejected move", () => {
    const config = restoreBoardConfig({
      fen,
      orientation: "white",
      lastMove: undefined,
      movableColor: "white",
      showDests: true,
      animate: true
    });
    expect(config.turnColor).toBe("white");
    expect(config.movable?.color).toBe("white");
    // The correct reply (Ra8#) must still be playable.
    expect(config.movable?.dests?.get("a1")).toContain("a8");
    expect(config.fen).toBe(fen);
  });

  it("respects the animation setting", () => {
    expect(
      restoreBoardConfig({
        fen,
        orientation: "black",
        lastMove: undefined,
        movableColor: undefined,
        showDests: false,
        animate: false
      }).animation?.enabled
    ).toBe(false);
  });
});

describe("board motion helpers", () => {
  const tree = [
    { id: "root", parentId: null },
    { id: "a", parentId: "root" },
    { id: "b", parentId: "a" }
  ];

  it("slides only single steps", () => {
    expect(isSingleStep(tree, "root", "a")).toBe(true);
    expect(isSingleStep(tree, "b", "a")).toBe(true);
    expect(isSingleStep(tree, "root", "b")).toBe(false);
    expect(isSingleStep(tree, null, "a")).toBe(false);
  });

  it("treats positions a move apart as one step and jumps as not", () => {
    const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const e4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    const later = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
    expect(isOneMoveApart(start, e4)).toBe(true);
    expect(isOneMoveApart(start, later)).toBe(false);
    expect(isOneMoveApart(start, start)).toBe(false);
  });
});
