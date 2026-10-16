import { describe, expect, it } from "vitest";
import { gridStep } from "./grid-keys";

describe("gridStep", () => {
  it("moves across and down a grid, and stops at its edges", () => {
    // 10 cards, 4 to a row: the card at 5 is on the second row, second column.
    expect(gridStep("ArrowRight", 5, 10, 4)).toBe(6);
    expect(gridStep("ArrowLeft", 5, 10, 4)).toBe(4);
    expect(gridStep("ArrowUp", 5, 10, 4)).toBe(1);
    expect(gridStep("ArrowDown", 5, 10, 4)).toBe(9);
    expect(gridStep("ArrowDown", 7, 10, 4)).toBeNull();
    expect(gridStep("ArrowLeft", 0, 10, 4)).toBeNull();
    expect(gridStep("Home", 5, 10, 4)).toBe(0);
    expect(gridStep("End", 5, 10, 4)).toBe(9);
    expect(gridStep("Enter", 5, 10, 4)).toBeNull();
  });
});
