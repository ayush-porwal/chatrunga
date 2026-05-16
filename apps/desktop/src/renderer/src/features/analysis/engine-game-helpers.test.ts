import { describe, expect, it } from "vitest";
import { currentLineUcis } from "./engine-game-helpers";
import type { MoveNode } from "@chaturanga/shared/types/chess";

function node(input: Partial<MoveNode> & Pick<MoveNode, "id" | "parentId">): MoveNode {
  return {
    san: null,
    uci: null,
    fenBefore: "before",
    fenAfter: "after",
    ply: 0,
    nags: [],
    comment: null,
    arrows: [],
    highlights: [],
    children: [],
    ...input
  };
}

describe("currentLineUcis", () => {
  it("returns the UCI moves from root to the selected node", () => {
    const tree = [
      node({ id: "root", parentId: null, children: ["a"] }),
      node({ id: "a", parentId: "root", uci: "e2e4", children: ["b"] }),
      node({ id: "b", parentId: "a", uci: "e7e5", children: ["c"] }),
      node({ id: "c", parentId: "b", uci: "g1f3" })
    ];

    expect(currentLineUcis(tree, "c")).toEqual(["e2e4", "e7e5", "g1f3"]);
  });

  it("returns an empty line for unknown nodes", () => {
    expect(currentLineUcis([node({ id: "root", parentId: null })], "missing")).toEqual([]);
  });
});
