import { describe, expect, it } from "vitest";
import {
  MIN_BOARD_EDGE,
  centringInsets,
  clampBoardEdge,
  draggedBoardEdge,
  snapBoardSize
} from "./board-frame";

/** Chessground's own rounding (render.ts `updateBounds`), which the frame must agree with. */
const chessgroundEdge = (width: number, ratio: number) =>
  (Math.floor((width * ratio) / 8) * 8) / ratio;

describe("snapBoardSize", () => {
  it("rounds down to whole device pixels per square", () => {
    expect(snapBoardSize(517.3, 1)).toBe(512);
    expect(snapBoardSize(517.3, 2)).toBe(516);
    expect(snapBoardSize(517.3, 1.25)).toBeCloseTo(512, 9);
    expect(snapBoardSize(519, 1.25)).toBeCloseTo(518.4, 9);
    expect(snapBoardSize(517.3, 1.5)).toBeCloseTo(512, 9);
  });

  it("agrees with Chessground, and Chessground keeps a snapped edge as it is", () => {
    for (const ratio of [1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
      // Layout sizes are whole 1/64 px units.
      for (let units = 100 * 64; units < 1400 * 64; units += 23) {
        const available = units / 64;
        const edge = snapBoardSize(available, ratio);
        expect(edge).toBeCloseTo(chessgroundEdge(available, ratio), 6);
        expect(edge).toBeLessThanOrEqual(available + 1e-9);
        // Every square is a whole number of device pixels.
        const square = (edge * ratio) / 8;
        expect(Math.abs(square - Math.round(square))).toBeLessThan(1e-6);
        // Measured back from layout (1/64 px units), the frame snaps to itself: no strip.
        expect(snapBoardSize(Math.ceil(edge * 64) / 64, ratio)).toBeCloseTo(edge, 6);
      }
    }
  });

  it("keeps an edge that is already whole despite float error", () => {
    expect(snapBoardSize(512 - 1e-12, 1)).toBe(512);
    expect(snapBoardSize((8 * 77) / 1.25, 1.25)).toBeCloseTo(492.8, 9);
  });

  it("is zero for no space or no ratio", () => {
    expect(snapBoardSize(0, 2)).toBe(0);
    expect(snapBoardSize(-4, 2)).toBe(0);
    expect(snapBoardSize(5, 2)).toBe(4);
    expect(snapBoardSize(400, 0)).toBe(0);
    expect(snapBoardSize(Number.NaN, 1)).toBe(0);
  });
});

describe("centringInsets", () => {
  const centre = (start: number, end: number, insets: { start: number; end: number }) =>
    (start + insets.start + end - insets.end) / 2;

  it("centres the workspace under the titlebar on the window", () => {
    // 800px tall window: 54px titlebar, the panel 8px above the bottom edge (1px borders).
    const insets = centringInsets(55, 791, 800);
    expect(insets).toEqual({ start: 0, end: 46 });
    expect(centre(55, 791, insets)).toBe(400);
  });

  it("keeps the longest centred span when a notice pushes the workspace further down", () => {
    const insets = centringInsets(160.5, 791, 800);
    expect(insets).toEqual({ start: 0, end: 791 - 639.5 });
    expect(centre(160.5, 791, insets)).toBe(400);
    // Mirrored: a span that reaches further before the centre than after it is trimmed at its start.
    expect(centringInsets(0, 900, 1000)).toEqual({ start: 100, end: 0 });
  });

  it("changes nothing for a span already centred on the window", () => {
    expect(centringInsets(30, 770, 800)).toEqual({ start: 0, end: 0 });
  });

  it("collapses to the centre line when the span doesn't reach it", () => {
    expect(centringInsets(600, 900, 1000)).toEqual({ start: 0, end: 400 });
  });
});

describe("draggedBoardEdge", () => {
  it("grows and shrinks the square by the pointer's larger move across or down", () => {
    expect(draggedBoardEdge(500, 40, 10, 900)).toBe(540);
    expect(draggedBoardEdge(500, -10, 30, 900)).toBe(530);
    expect(draggedBoardEdge(500, -60, -20, 900)).toBe(480);
    // Straight left or up alone leaves it: the other move (none) is the larger.
    expect(draggedBoardEdge(500, -80, 0, 900)).toBe(500);
  });

  it("stops at the edge that leaves the side panel its minimum width", () => {
    expect(draggedBoardEdge(700, 300, 0, 820)).toBe(820);
  });

  it("never shrinks the board below the minimum edge", () => {
    expect(draggedBoardEdge(300, -400, -400, 900)).toBe(MIN_BOARD_EDGE);
  });
});

describe("clampBoardEdge", () => {
  it("keeps an edge inside the bounds as it is", () => {
    expect(clampBoardEdge(512.5, 900)).toBe(512.5);
  });

  it("gives way to a space smaller than the minimum edge", () => {
    expect(clampBoardEdge(400, MIN_BOARD_EDGE - 40)).toBe(MIN_BOARD_EDGE - 40);
    expect(clampBoardEdge(400, -5)).toBe(0);
  });
});
