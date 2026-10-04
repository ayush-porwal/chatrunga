import { describe, expect, it } from "vitest";
import {
  MIN_BOARD_EDGE,
  centringInsets,
  clampBoardEdge,
  draggedBoardEdge,
  keyedBoardEdge,
  restoredBoardEdge,
  snapBoardSize,
  splitterBoardEdge
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
  it("shrinks the board straight left or up, and grows it straight right or down", () => {
    expect(draggedBoardEdge(500, -80, 0, 900)).toBe(420);
    expect(draggedBoardEdge(500, 40, 0, 900)).toBe(540);
    // The corner moves half the edge change down (the board is centred down): twice the move.
    expect(draggedBoardEdge(500, 0, -50, 900)).toBe(400);
    expect(draggedBoardEdge(500, 0, 30, 900)).toBe(560);
  });

  it("follows the axis the pointer moved most along on a diagonal", () => {
    // Across leads: 40 against twice 10 down.
    expect(draggedBoardEdge(500, 40, 10, 900)).toBe(540);
    // Down leads: twice 30 against 10 left; and twice 40 up against 60 left.
    expect(draggedBoardEdge(500, -10, 30, 900)).toBe(560);
    expect(draggedBoardEdge(500, -60, -40, 900)).toBe(420);
    // Along the corner's own path (d across, d/2 down) both agree, and the grip stays under it.
    expect(draggedBoardEdge(500, -140, -70, 900)).toBe(360);
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

  it("keeps a board of at least 280px, the smallest still playable", () => {
    expect(clampBoardEdge(150, 900)).toBe(280);
    expect(clampBoardEdge(280, 900)).toBe(280);
  });

  it("gives way to a space smaller than the minimum edge", () => {
    expect(clampBoardEdge(400, MIN_BOARD_EDGE - 40)).toBe(MIN_BOARD_EDGE - 40);
    expect(clampBoardEdge(400, -5)).toBe(0);
  });
});

describe("restoredBoardEdge", () => {
  it("restores a remembered edge, and a filled board as filled", () => {
    expect(restoredBoardEdge(490)).toBe(490);
    expect(restoredBoardEdge(null)).toBeNull();
  });

  it("brings an edge remembered below the minimum up to it", () => {
    expect(restoredBoardEdge(240)).toBe(MIN_BOARD_EDGE);
  });
});

describe("splitterBoardEdge", () => {
  it("shrinks the board as the splitter moves left and grows it as it moves right", () => {
    expect(splitterBoardEdge(600, -120, 900)).toBe(480);
    expect(splitterBoardEdge(600, 90, 900)).toBe(690);
    // A board limited by the height starts from its measured edge: the first pixel moves it one.
    expect(splitterBoardEdge(612.5, -1, 612.5)).toBe(611.5);
  });

  it("stops at the minimum edge, and where the panel reaches its minimum width", () => {
    expect(splitterBoardEdge(400, -300, 900)).toBe(MIN_BOARD_EDGE);
    expect(splitterBoardEdge(700, 400, 820)).toBe(820);
  });
});

describe("keyedBoardEdge", () => {
  it("steps the edge with the arrow keys, further with Shift", () => {
    expect(keyedBoardEdge("ArrowLeft", false, 600, 900)).toBe(584);
    expect(keyedBoardEdge("ArrowRight", false, 600, 900)).toBe(616);
    expect(keyedBoardEdge("ArrowLeft", true, 600, 900)).toBe(536);
    expect(keyedBoardEdge("ArrowRight", true, 600, 900)).toBe(664);
  });

  it("stays within the bounds", () => {
    expect(keyedBoardEdge("ArrowLeft", true, MIN_BOARD_EDGE + 10, 900)).toBe(MIN_BOARD_EDGE);
    expect(keyedBoardEdge("ArrowRight", true, 880, 900)).toBe(900);
  });

  it("goes to the smallest and largest edge with Home and End, and back to fill with Enter", () => {
    expect(keyedBoardEdge("Home", false, 600, 900)).toBe(MIN_BOARD_EDGE);
    expect(keyedBoardEdge("End", false, 600, 900)).toBe(900);
    expect(keyedBoardEdge("Enter", false, 600, 900)).toBe("fill");
  });

  it("leaves every other key to the page", () => {
    for (const key of ["ArrowUp", "ArrowDown", " ", "a", "Escape"])
      expect(keyedBoardEdge(key, false, 600, 900)).toBeNull();
  });
});
