import { describe, expect, it } from "vitest";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { buildTreeModel } from "./move-tree-model";

function node(
  id: string,
  parentId: string | null,
  ply: number,
  children: string[] = []
): MoveNode {
  return {
    id,
    parentId,
    san: id === "root" ? null : id.toUpperCase(),
    uci: id === "root" ? null : `${id.slice(0, 2)}${id.slice(0, 2)}`,
    fenBefore: "start",
    fenAfter: `after-${id}`,
    ply,
    nags: [],
    comment: null,
    arrows: [],
    highlights: [],
    children
  };
}

describe("buildTreeModel", () => {
  it("keeps the first child as the mainline and attaches later children as variations", () => {
    const nodes = [
      node("root", null, 0, ["main", "alt"]),
      node("main", "root", 1, ["reply"]),
      node("reply", "main", 2),
      node("alt", "root", 1, ["altReply", "nestedAlt"]),
      node("altReply", "alt", 2),
      node("nestedAlt", "alt", 2, ["deep"]),
      node("deep", "nestedAlt", 3)
    ];

    const model = buildTreeModel(nodes);

    expect(model.mainline).toHaveLength(1);
    expect(model.mainline[0].white?.id).toBe("main");
    expect(model.mainline[0].black?.id).toBe("reply");
    expect(model.rootVariations[0].rows.map((row) => row.node.id)).toEqual(["alt", "altReply", "nestedAlt", "deep"]);
    expect(model.rootVariations[0].rows.at(-1)?.depth).toBe(1);
  });

  it("traverses very deep variation chains iteratively", () => {
    const depth = 1_200;
    const nodes: MoveNode[] = [node("root", null, 0, ["main", "alt"]), node("alt", "root", 1, ["alt-0"])];
    nodes.push(node("main", "root", 1));
    let parentId = "alt";
    for (let index = 0; index < depth; index += 1) {
      const id = `alt-${index}`;
      const childId = index + 1 < depth ? `alt-${index + 1}` : "";
      nodes.push(node(id, parentId, index + 2, childId ? [childId] : []));
      parentId = id;
    }

    const model = buildTreeModel(nodes);
    const rows = model.variationsByParent.get("root")?.[0].rows ?? [];

    expect(rows).toHaveLength(depth + 1);
    expect(Math.max(...rows.map((row) => row.depth))).toBe(0);
  });
});
