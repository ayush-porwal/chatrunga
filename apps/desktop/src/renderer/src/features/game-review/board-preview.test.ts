import { beforeEach, describe, expect, it } from "vitest";
import {
  previewShapes,
  shownPreview,
  useBoardPreviewStore,
  type BoardPreview
} from "./board-preview";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

const move: BoardPreview = { kind: "move", fen: START, uci: "e2e4" };
const square: BoardPreview = { kind: "square", fen: AFTER_E4, square: "f6" };

describe("board previews", () => {
  beforeEach(() => useBoardPreviewStore.setState({ active: null }));

  it("draws a move as its arrow and a square as a ring", () => {
    expect(previewShapes(move)).toStrictEqual([{ orig: "e2", dest: "e4", brush: "green" }]);
    expect(previewShapes(square)).toStrictEqual([{ orig: "f6", brush: "yellow" }]);
    expect(previewShapes({ kind: "move", fen: START, uci: "zz" })).toStrictEqual([]);
  });

  it("shows only over the position the board had when it began", () => {
    useBoardPreviewStore.getState().show(move, AFTER_E4);
    const { active } = useBoardPreviewStore.getState();
    expect(shownPreview(active, AFTER_E4)).toBe(move);
    // The board moved since (the link was clicked, a step): the preview no longer shows.
    expect(shownPreview(active, START)).toBeNull();
    expect(shownPreview(null, AFTER_E4)).toBeNull();
  });

  it("ends only the preview it is asked to end", () => {
    const store = useBoardPreviewStore.getState();
    store.show(move, START);
    // The pointer went from the move to the square: leaving the move later keeps the square's.
    store.show(square, START);
    store.clear(move);
    expect(useBoardPreviewStore.getState().active?.preview).toBe(square);
    store.clear(square);
    expect(useBoardPreviewStore.getState().active).toBeNull();
  });
});
