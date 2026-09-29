import { describe, expect, it } from "vitest";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { mainlineEnd, sameDocument, savedResult } from "./useGameAutosave";

const node = (id: string, parentId: string | null, children: string[]): MoveNode => ({
  id,
  parentId,
  san: parentId ? id : null,
  uci: null,
  fenBefore: "",
  fenAfter: id,
  ply: 0,
  nags: [],
  comment: null,
  arrows: [],
  highlights: [],
  children
});

describe("savedResult", () => {
  it("prefers the outcome of a finished game, then a terminal end of the main line", () => {
    expect(savedResult("0-1", "*", "1-0", true)).toBe("0-1");
    expect(savedResult(undefined, "1-0", "*", false)).toBe("1-0");
  });

  it("keeps a decided game's recorded result while its main line is unchanged", () => {
    expect(savedResult(undefined, "*", "1-0", true)).toBe("1-0");
  });

  it("drops the recorded result once the main line's final moves are edited", () => {
    expect(savedResult(undefined, "*", "1-0", false)).toBe("*");
  });

  it("reads an undecided game as in progress", () => {
    expect(savedResult(undefined, "*", "*", true)).toBe("*");
    expect(savedResult(undefined, "*", null, true)).toBe("*");
    expect(savedResult(undefined, "*", undefined, true)).toBe("*");
  });
});

describe("mainlineEnd", () => {
  it("follows the first child from the root, ignoring side variations", () => {
    const tree = [node("root", null, ["e4", "d4"]), node("e4", "root", ["e5"]), node("d4", "root", []), node("e5", "e4", [])];
    expect(mainlineEnd(tree)?.id).toBe("e5");
  });

  it("is the root for an empty game", () => {
    expect(mainlineEnd([node("root", null, [])])?.id).toBe("root");
  });
});

describe("sameDocument", () => {
  const tree = [node("root", null, [])];
  const headers = { result: "*" };
  const doc = { gameId: "g", source: "pgn-import" as const, moveTree: tree, headers, currentNodeId: "root", gameOutcome: null, review: null };

  it("matches the document the library already holds", () => {
    expect(sameDocument(doc, { ...doc })).toBe(true);
  });

  it("differs once anything that is saved changes", () => {
    expect(sameDocument(null, doc)).toBe(false);
    expect(sameDocument(doc, { ...doc, currentNodeId: "e4" })).toBe(false);
    expect(sameDocument(doc, { ...doc, source: "analysis" })).toBe(false);
    expect(sameDocument(doc, { ...doc, moveTree: [...tree] })).toBe(false);
    expect(sameDocument(doc, { ...doc, headers: { result: "1-0" } })).toBe(false);
    expect(sameDocument(doc, { ...doc, gameOutcome: { result: "1-0", termination: "Resignation" } })).toBe(false);
  });
});
