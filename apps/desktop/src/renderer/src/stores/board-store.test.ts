import { beforeEach, describe, expect, it } from "vitest";
import { useBoardStore } from "./board-store";

describe("board store", () => {
  beforeEach(() => {
    useBoardStore.setState({
      selectedSquare: null,
      legalTargets: [],
      arrows: [],
      highlights: [],
      drawingArrow: null
    });
  });

  it("tracks selection and legal targets", () => {
    useBoardStore.getState().setSelectedSquare("e2");
    useBoardStore.getState().setLegalTargets(["e3", "e4"]);

    expect(useBoardStore.getState()).toMatchObject({
      selectedSquare: "e2",
      legalTargets: ["e3", "e4"]
    });
  });

  it("sets, appends, and clears annotations", () => {
    useBoardStore.getState().setAnnotations(
      [{ orig: "e2", dest: "e4", color: "green" }],
      [{ square: "e4", color: "yellow" }]
    );
    useBoardStore.getState().addArrow({ orig: "g1", dest: "f3", color: "blue" });
    useBoardStore.getState().addHighlight({ square: "f3", color: "red" });

    expect(useBoardStore.getState().arrows).toHaveLength(2);
    expect(useBoardStore.getState().highlights).toHaveLength(2);

    useBoardStore.getState().clearAnnotationsForCurrentNode();
    expect(useBoardStore.getState().arrows).toEqual([]);
    expect(useBoardStore.getState().highlights).toEqual([]);
  });
});
