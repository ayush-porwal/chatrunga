import { describe, expect, it } from "vitest";
import { buildChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { buildTreeModel } from "../game/move-tree-model";
import { addLine, rootNode } from "./__fixtures__/repertoire";
import {
  collapseStudyTree,
  COLLAPSE_MIN_MOVES,
  expandPathTo,
  isHidden,
  placeholderId,
  placeholderParent,
  subtreeSizes
} from "./study-tree-model";

/**
 * Main line m0–m4 (1. e4 e5 2. Nf3 Nc6 3. Bb5); after 1. e4 the side line v0–v3 (1… c5 2. Nf3
 * d6 3. d4), and after 1… c5 the side line x0–x1 (2. Nc3 Nc6).
 */
function sampleTree(): MoveNode[] {
  let tree = [rootNode()];
  ({ tree } = addLine(tree, "root", ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"], "m"));
  ({ tree } = addLine(tree, "m0", ["c7c5", "g1f3", "d7d6", "d2d4"], "v"));
  ({ tree } = addLine(tree, "v0", ["b1c3", "b8c6"], "x"));
  return tree;
}

const ids = (nodes: readonly MoveNode[]) => nodes.map((node) => node.id).sort();
const lookupOf = (tree: MoveNode[]) => buildChapterLookup({ tree });

describe("study tree collapsing", () => {
  it("leaves chapters below the size threshold untouched", () => {
    const tree = sampleTree();
    const result = collapseStudyTree(lookupOf(tree), { expanded: new Set(), depth: 0 });
    expect(tree.length - 1).toBeLessThan(COLLAPSE_MIN_MOVES);
    expect(result.nodes).toHaveLength(tree.length);
    expect(result.placeholders.size).toBe(0);
    expect(result.visible).toBeNull();
    expect(isHidden(result, lookupOf(tree), "v3")).toBe(false);
  });

  it("cuts side lines deeper than the depth into one counted row per cut point", () => {
    const tree = sampleTree();
    const lookup = lookupOf(tree);
    const result = collapseStudyTree(lookup, { expanded: new Set(), depth: 2, minMoves: 0 });

    // v0 and v1 are 1–2 plies into the side line; v2 and v3 hide behind v1, x1 behind x0.
    const kept = tree.filter((node) => !["v2", "v3", "x1"].includes(node.id));
    expect(ids(result.nodes)).toEqual(
      [...kept.map((node) => node.id), placeholderId("v1"), placeholderId("x0")].sort()
    );
    expect(result.placeholders).toEqual(
      new Map([
        [placeholderId("v1"), 2],
        [placeholderId("x0"), 1]
      ])
    );
    expect(result.hiddenMoves).toBe(3);
    const v1 = result.nodes.find((node) => node.id === "v1")!;
    expect(v1.children).toEqual([placeholderId("v1")]);
    const placeholder = result.nodes.find((node) => node.id === placeholderId("v1"))!;
    expect(placeholder).toMatchObject({ parentId: "v1", ply: v1.ply + 1, san: null });
    expect(placeholder.fenBefore).toBe(v1.fenAfter);

    // Untouched nodes keep their identity (memoised rows don't re-render).
    const original = new Map(tree.map((node) => [node.id, node]));
    for (const id of ["root", "m0", "m4", "v0"]) {
      expect(result.nodes.find((node) => node.id === id)).toBe(original.get(id));
    }
    expect(isHidden(result, lookup, "v3")).toBe(true);
    expect(isHidden(result, lookup, "v1")).toBe(false);
    expect(isHidden(result, lookup, "nope")).toBe(false);
  });

  it("puts the row where the first hidden branch was", () => {
    const tree = sampleTree();
    const result = collapseStudyTree(lookupOf(tree), {
      expanded: new Set(),
      depth: 0,
      minMoves: 0
    });
    // The main line always shows; every side line of it hides behind one row after it.
    const m0 = result.nodes.find((node) => node.id === "m0")!;
    expect(m0.children).toEqual(["m1", placeholderId("m0")]);
    expect(result.placeholders.get(placeholderId("m0"))).toBe(6);
    expect(ids(result.nodes)).toEqual(
      ["root", "m0", "m1", "m2", "m3", "m4", placeholderId("m0")].sort()
    );
  });

  it("shows more plies below an expanded node", () => {
    const tree = sampleTree();
    const result = collapseStudyTree(lookupOf(tree), {
      expanded: new Set(["v1"]),
      depth: 2,
      minMoves: 0
    });
    expect(result.placeholders).toEqual(new Map([[placeholderId("x0"), 1]]));
    expect(result.nodes.some((node) => node.id === "v3")).toBe(true);
  });

  it("expands the path to a selected hidden move, which then shows", () => {
    const tree = sampleTree();
    const lookup = lookupOf(tree);
    const options = { depth: 1, minMoves: 0 };
    const before = collapseStudyTree(lookup, { ...options, expanded: new Set() });
    expect(isHidden(before, lookup, "v3")).toBe(true);

    const expanded = expandPathTo(new Set(["x0"]), lookup, "v3");
    expect([...expanded].sort()).toEqual(["m0", "root", "v0", "v1", "v2", "v3", "x0"]);
    const after = collapseStudyTree(lookup, { ...options, expanded });
    expect(isHidden(after, lookup, "v3")).toBe(false);
    // Nothing is left to hide: the whole tree shows.
    expect(after.visible).toBeNull();
    expect(after.nodes).toHaveLength(tree.length);

    const partly = collapseStudyTree(lookup, {
      ...options,
      expanded: expandPathTo(new Set(), lookup, "v2")
    });
    expect(partly.visible?.has("v3")).toBe(true);
    expect(partly.placeholders).toEqual(new Map([[placeholderId("x0"), 1]]));
  });

  it("counts subtree sizes once per tree and round-trips placeholder ids", () => {
    const sizes = subtreeSizes(lookupOf(sampleTree()));
    expect(sizes.get("root")).toBe(12);
    expect(sizes.get("m0")).toBe(11);
    expect(sizes.get("v0")).toBe(6);
    expect(sizes.get("x1")).toBe(1);
    expect(placeholderParent(placeholderId("v1"))).toBe("v1");
    expect(placeholderParent("v1")).toBeNull();
  });

  it("feeds the tree view a placeholder as a variation row's move", () => {
    const tree = sampleTree();
    const result = collapseStudyTree(lookupOf(tree), {
      expanded: new Set(),
      depth: 0,
      minMoves: 0
    });
    const model = buildTreeModel(result.nodes);
    // The cut branches of 1. e4 were played instead of 1… e5: their row stands under it.
    const rows = model.variationsByMove.get("m1")!;
    expect(rows).toHaveLength(1);
    expect(rows[0].moves.map((move) => [move.node.id, move.number])).toEqual([
      [placeholderId("m0"), null]
    ]);
    expect(model.mainline.map((row) => row.white?.id)).toEqual(["m0", "m2", "m4"]);
  });
});
