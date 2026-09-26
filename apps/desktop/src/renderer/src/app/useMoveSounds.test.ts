import { describe, expect, it } from "vitest";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { movedNodeBetween, pickSound } from "./useMoveSounds";

function node(id: string, parentId: string | null, children: string[] = []): MoveNode {
  return {
    id,
    parentId,
    san: id,
    uci: null,
    fenBefore: "",
    fenAfter: "",
    ply: 0,
    nags: [],
    comment: null,
    arrows: [],
    highlights: [],
    children
  };
}

// root → a → b → c, with a side line a → x
const tree = [node("root", null, ["a"]), node("a", "root", ["b", "x"]), node("b", "a", ["c"]), node("c", "b"), node("x", "a")];

describe("movedNodeBetween", () => {
  it("finds the move for forward and backward steps", () => {
    expect(movedNodeBetween(tree, "a", "b")?.id).toBe("b");
    expect(movedNodeBetween(tree, "b", "a")?.id).toBe("b");
  });

  it("finds the first move below the start on a longer jump", () => {
    expect(movedNodeBetween(tree, "a", "c")?.id).toBe("b");
  });

  it("returns null when the nodes are on different lines", () => {
    expect(movedNodeBetween(tree, "c", "x")).toBeNull();
  });
});

describe("pickSound", () => {
  const base = { result: "*", isEnd: false, engineSide: null, orientation: "white" } as const;

  it("picks check, capture or move from the SAN", () => {
    expect(pickSound({ ...base, san: "Qxf7#" })).toBe("check");
    expect(pickSound({ ...base, san: "Bxc6" })).toBe("capture");
    expect(pickSound({ ...base, san: "Nf3" })).toBe("move");
  });

  it("judges the result from the user's side", () => {
    expect(pickSound({ ...base, san: "Qh7#", isEnd: true, result: "1-0" })).toBe("victory");
    expect(pickSound({ ...base, san: "Qh2#", isEnd: true, result: "0-1" })).toBe("defeat");
    expect(pickSound({ ...base, san: "Qh2#", isEnd: true, result: "0-1", engineSide: "white" })).toBe("victory");
    expect(pickSound({ ...base, san: "Kh1", isEnd: true, result: "1/2-1/2" })).toBe("draw");
  });
});
