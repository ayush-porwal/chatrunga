import { describe, expect, it } from "vitest";
import type { MoveNode } from "../types/chess";
import type { RepertoireColor, RepertoireNodeMeta } from "../types/repertoire";
import { applySan, START_FEN } from "./position";
import {
  continuations,
  enumerateLines,
  lineIdOf,
  nextOnRoute,
  planRoute,
  rehearsalContext
} from "./repertoire-rehearsal";

/** Builds a tree from SAN lines; shared prefixes share nodes. Ids are the SAN path (`e4/e5`). */
function treeFromLines(lines: string[][]): MoveNode[] {
  const root: MoveNode = {
    id: "root",
    parentId: null,
    san: null,
    uci: null,
    fenBefore: START_FEN,
    fenAfter: START_FEN,
    ply: 0,
    nags: [],
    comment: null,
    arrows: [],
    highlights: [],
    children: []
  };
  const byId = new Map([[root.id, root]]);
  for (const line of lines) {
    let parent = root;
    const path: string[] = [];
    for (const san of line) {
      path.push(san);
      const id = path.join("/");
      let node = byId.get(id);
      if (!node) {
        const applied = applySan(parent.fenAfter, san);
        if (!applied) throw new Error(`illegal ${san} after ${path.join(" ")}`);
        node = {
          id,
          parentId: parent.id,
          san: applied.san,
          uci: applied.uci,
          fenBefore: parent.fenAfter,
          fenAfter: applied.fen,
          ply: parent.ply + 1,
          nags: [],
          comment: null,
          arrows: [],
          highlights: [],
          children: []
        };
        parent.children.push(id);
        byId.set(id, node);
      }
      parent = node;
    }
  }
  return [...byId.values()];
}

function contextOf(
  lines: string[][],
  nodeMeta: Record<string, RepertoireNodeMeta> = {},
  { color = "white", depth }: { color?: RepertoireColor; depth?: number } = {}
) {
  return rehearsalContext(
    { kind: "opening", enabled: true, tree: treeFromLines(lines), nodeMeta },
    color,
    depth
  );
}

describe("enumerateLines", () => {
  it("lists authored lines depth first and ends them at leaves", () => {
    const context = contextOf([
      ["e4", "c5", "Nf3", "d6"],
      ["e4", "c5", "Nf3", "Nc6"],
      ["e4", "e5", "Nf3"]
    ]);
    const lines = enumerateLines(context, "root");
    expect(lines.map((line) => [line.endNodeId, line.endReason])).toEqual([
      ["e4/c5/Nf3/d6", "leaf"],
      ["e4/c5/Nf3/Nc6", "leaf"],
      ["e4/e5/Nf3", "leaf"]
    ]);
    expect(lines[0]).toMatchObject({
      lineId: lineIdOf("e4/c5/Nf3/d6"),
      nodeIds: ["root", "e4", "e4/c5", "e4/c5/Nf3", "e4/c5/Nf3/d6"],
      decisionNodeIds: ["root", "e4/c5"]
    });
  });

  it("stops at a stop marker and at the depth limit", () => {
    const context = contextOf(
      [
        ["e4", "c5", "Nf3", "d6"],
        ["e4", "e5", "Nf3", "Nc6", "Bb5"]
      ],
      { "e4/c5": { edge: "covered", trainingStop: true } },
      { depth: 3 }
    );
    expect(enumerateLines(context, "root").map((line) => [line.endNodeId, line.endReason])).toEqual(
      [
        ["e4/c5", "stop"],
        ["e4/e5/Nf3", "depth"]
      ]
    );
  });

  it("leaves out disabled and reference branches, and lines without a player move", () => {
    const context = contextOf(
      [["e4", "c5", "Nf3"], ["e4", "e5", "Nf3"], ["e4", "d5", "exd5"], ["d4"]],
      {
        "e4/e5": { edge: "covered", disabled: true },
        "e4/d5/exd5": { edge: "reference" },
        d4: { edge: "reference" }
      }
    );
    const lines = enumerateLines(context, "root");
    // e4 d5 ends at a leaf (its only continuation is reference); it still has the 1.e4 decision.
    expect(lines.map((line) => line.endNodeId)).toEqual(["e4/c5/Nf3", "e4/d5"]);
    // From an opponent-to-move position whose replies end immediately, nothing is rehearsable.
    expect(enumerateLines(context, "e4/d5")).toEqual([]);
    expect(enumerateLines(context, "missing")).toEqual([]);
    expect(continuations(context, "e4/e5")).toEqual({ children: [], end: "leaf" });
  });

  it("follows only included moves at the player's turn", () => {
    const context = contextOf(
      [
        ["e4", "e5"],
        ["d4", "d5"]
      ],
      { d4: { edge: "covered" } }
    );
    expect(enumerateLines(context, "root").map((line) => line.endNodeId)).toEqual(["e4/e5"]);
  });
});

describe("planRoute", () => {
  const lines = [
    ["e4", "c5", "Nf3", "d6"],
    ["e4", "c5", "Nf3", "Nc6"],
    ["e4", "e5", "Nf3"]
  ];

  it("prefers replies not yet seen, then authored order, deterministically", () => {
    const context = contextOf(lines);
    const pending = new Set(enumerateLines(context, "root").map((line) => line.endNodeId));
    const seen: Record<string, number> = {};
    const play = () => {
      const plan = planRoute(context, "root", pending, seen);
      for (const id of plan.nodeIds) {
        if (id.split("/").length % 2 === 0) seen[id] = (seen[id] ?? 0) + 1;
      }
      pending.delete(plan.endNodeId);
      return plan.endNodeId;
    };
    // Second run: 1...e5 has never been seen, so it comes before the other 1...c5 line.
    expect([play(), play(), play()]).toEqual(["e4/c5/Nf3/d6", "e4/e5/Nf3", "e4/c5/Nf3/Nc6"]);
    // Nothing pending: rotation alone (fewest times seen, then authored order).
    expect(planRoute(context, "root", pending, seen).endNodeId).toBe("e4/e5/Nf3");
    expect(planRoute(context, "root", new Set(), { "e4/c5": 2, "e4/e5": 2 })).toMatchObject({
      endNodeId: "e4/c5/Nf3/d6",
      endReason: "leaf"
    });
    // Same inputs, same plan.
    const again = contextOf(lines);
    expect(planRoute(again, "root", new Set(), { "e4/c5": 2, "e4/e5": 2 }).endNodeId).toBe(
      "e4/c5/Nf3/d6"
    );
  });

  it("finds the move on a route", () => {
    const context = contextOf(lines);
    expect(nextOnRoute(context.lookup, "e4", "e4/e5/Nf3")?.id).toBe("e4/e5");
    expect(nextOnRoute(context.lookup, "e4/c5", "e4/e5/Nf3")).toBeNull();
    expect(nextOnRoute(context.lookup, "e4/e5/Nf3", "e4/e5/Nf3")).toBeNull();
  });
});
