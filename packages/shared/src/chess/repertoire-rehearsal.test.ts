import { describe, expect, it } from "vitest";
import type { MoveNode } from "../types/chess";
import type { RepertoireColor, RepertoireNodeMeta } from "../types/repertoire";
import { applySan, START_FEN } from "./position";
import { buildChapterLookup } from "./repertoire-index";
import {
  canRehearseFrom,
  continuations,
  enumerateLines,
  isDecisionNode,
  lineEnds,
  lineIdOf,
  nextOnRoute,
  planRoute,
  rehearsalContext,
  type RehearsalContext
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
    { maxDepthPlies: depth }
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
    expect(lines.map((line) => [line.endNodeId, line.endReason])).toStrictEqual([
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

  it("never asks a paused decision, and leaves out a line with no other decision", () => {
    const tree = treeFromLines([
      ["e4", "c5", "Nf3", "d6", "d4"],
      ["e4", "e5", "Nf3"]
    ]);
    const chapter = { kind: "opening" as const, enabled: true, tree, nodeMeta: {} };
    const lookup = buildChapterLookup(chapter);
    const keyOf = (id: string) => lookup.positionKeys.get(id)!;
    const context = rehearsalContext(chapter, "white", {
      lookup,
      paused: new Set([keyOf("e4/c5"), keyOf("e4/e5")])
    });
    expect(isDecisionNode(context, "e4/c5")).toBe(false);
    expect(isDecisionNode(context, "e4/c5/Nf3/d6")).toBe(true);
    expect(enumerateLines(context, "root").map((line) => line.decisionNodeIds)).toStrictEqual([
      ["root", "e4/c5/Nf3/d6"],
      ["root"]
    ]);
    // From 1... e5 the only decision left is paused: nothing to rehearse there.
    expect(enumerateLines(context, "e4/e5")).toStrictEqual([]);
    expect(canRehearseFrom(context, "e4/e5")).toBe(false);
    expect(canRehearseFrom(context, "e4/c5")).toBe(true);
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
    expect(
      enumerateLines(context, "root").map((line) => [line.endNodeId, line.endReason])
    ).toStrictEqual([
      ["e4/c5", "stop"],
      ["e4/e5/Nf3", "depth"]
    ]);
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
    expect(lines.map((line) => line.endNodeId)).toStrictEqual(["e4/c5/Nf3", "e4/d5"]);
    // From an opponent-to-move position whose replies end immediately, nothing is rehearsable.
    expect(enumerateLines(context, "e4/d5")).toStrictEqual([]);
    expect(enumerateLines(context, "missing")).toStrictEqual([]);
    expect(continuations(context, "e4/e5")).toStrictEqual({ children: [], end: "leaf" });
  });

  it("passes through the lead-up above a start marker without testing it", () => {
    const lines = [
      ["e4", "c5", "Nf3", "d6"],
      ["e4", "c5", "Nf3", "Nc6"],
      ["e4", "e5", "Nf3"],
      ["d4", "d5"]
    ];
    const context = contextOf(lines, { "e4/c5": { edge: "included", trainingStart: true } });
    const fromRoot = enumerateLines(context, "root");
    expect(fromRoot.map((line) => line.endNodeId)).toStrictEqual(["e4/c5/Nf3/d6", "e4/c5/Nf3/Nc6"]);
    expect(fromRoot[0]).toMatchObject({
      nodeIds: ["root", "e4", "e4/c5", "e4/c5/Nf3", "e4/c5/Nf3/d6"],
      decisionNodeIds: ["e4/c5"]
    });
    // From inside the lead-up too; a lead-up branch that never reaches training scope is no line.
    expect(enumerateLines(context, "e4").map((line) => line.endNodeId)).toStrictEqual([
      "e4/c5/Nf3/d6",
      "e4/c5/Nf3/Nc6"
    ]);
    expect(planRoute(context, "root", { pending: new Set(), seen: {} })).toMatchObject({
      endNodeId: "e4/c5/Nf3/d6",
      nodeIds: ["root", "e4", "e4/c5", "e4/c5/Nf3", "e4/c5/Nf3/d6"]
    });
  });

  it("finds the same line ends without building the lines", () => {
    const context = contextOf(
      [
        ["e4", "c5", "Nf3", "d6"],
        ["e4", "c5", "Nf3", "Nc6"],
        ["e4", "e5", "Nf3"],
        ["d4", "d5", "c4"],
        ["c4"]
      ],
      { "e4/c5/Nf3": { edge: "included", trainingStop: true } }
    );
    for (const start of ["root", "e4", "e4/c5", "d4", "c4", "missing"]) {
      expect(lineEnds(context, start)).toStrictEqual(
        enumerateLines(context, start).map((line) => line.endNodeId)
      );
    }
  });

  it("plays every lead-up move towards a training start at the player's turn", () => {
    const context = contextOf(
      [
        ["d4", "d5", "c4"],
        ["e4", "c5", "Nf3"]
      ],
      {
        "d4/d5": { edge: "included", trainingStart: true },
        "e4/c5": { edge: "included", trainingStart: true }
      }
    );
    expect(enumerateLines(context, "root").map((line) => line.endNodeId)).toStrictEqual([
      "d4/d5/c4",
      "e4/c5/Nf3"
    ]);
    expect(continuations(context, "root")).toStrictEqual({ children: ["d4", "e4"], end: null });
  });

  it("offers a rehearsal only in training scope and within the depth limit", () => {
    const context = contextOf(
      [
        ["e4", "c5", "Nf3", "d6"],
        ["d4", "d5"]
      ],
      {
        e4: { edge: "included", trainingStart: true },
        "e4/c5/Nf3": { edge: "included", trainingStop: true },
        d4: { edge: "reference" }
      },
      { depth: 3 }
    );
    expect(canRehearseFrom(context, "root")).toBe(false);
    expect(canRehearseFrom(context, "e4")).toBe(true);
    expect(canRehearseFrom(context, "e4/c5")).toBe(true);
    // The stop node is in scope but its next move is past the depth limit; below it is out.
    expect(canRehearseFrom(context, "e4/c5/Nf3")).toBe(false);
    expect(canRehearseFrom(context, "e4/c5/Nf3/d6")).toBe(false);
    expect(canRehearseFrom(context, "d4")).toBe(false);
    expect(canRehearseFrom(context, "missing")).toBe(false);
  });

  it("offers no rehearsal where no line asks a move: a stop or a leaf", () => {
    const context = contextOf(
      [
        ["e4", "c5", "Nf3"],
        ["e4", "e5"]
      ],
      { "e4/c5": { edge: "covered", trainingStop: true } }
    );
    expect(canRehearseFrom(context, "root")).toBe(true);
    expect(canRehearseFrom(context, "e4/c5")).toBe(false);
    expect(canRehearseFrom(context, "e4/e5")).toBe(false);
  });

  it("follows only included moves at the player's turn", () => {
    const context = contextOf(
      [
        ["e4", "e5"],
        ["d4", "d5"]
      ],
      { d4: { edge: "covered" } }
    );
    expect(enumerateLines(context, "root").map((line) => line.endNodeId)).toStrictEqual(["e4/e5"]);
  });
});

describe("planRoute", () => {
  const lines = [
    ["e4", "c5", "Nf3", "d6"],
    ["e4", "c5", "Nf3", "Nc6"],
    ["e4", "e5", "Nf3"]
  ];

  /** Plays the planned line as a session would: its replies count as seen, its end is done. */
  function playPlanned(
    context: RehearsalContext,
    pending: Set<string>,
    seen: Record<string, number>
  ): string {
    const plan = planRoute(context, "root", { pending, seen });
    // Ids are SAN paths: an even number of moves ends on the opponent's reply.
    const replies = plan.nodeIds.filter((id) => id.split("/").length % 2 === 0);
    for (const id of replies) seen[id] = (seen[id] ?? 0) + 1;
    pending.delete(plan.endNodeId);
    return plan.endNodeId;
  }

  it("prefers replies not yet seen, then authored order, deterministically", () => {
    const context = contextOf(lines);
    const pending = new Set(enumerateLines(context, "root").map((line) => line.endNodeId));
    const seen: Record<string, number> = {};
    const play = () => playPlanned(context, pending, seen);
    // Second run: 1...e5 has never been seen, so it comes before the other 1...c5 line.
    expect([play(), play(), play()]).toStrictEqual(["e4/c5/Nf3/d6", "e4/e5/Nf3", "e4/c5/Nf3/Nc6"]);
    // Nothing pending: rotation alone (fewest times seen, then authored order).
    expect(planRoute(context, "root", { pending, seen }).endNodeId).toBe("e4/e5/Nf3");
    expect(
      planRoute(context, "root", { pending: new Set(), seen: { "e4/c5": 2, "e4/e5": 2 } })
    ).toMatchObject({
      endNodeId: "e4/c5/Nf3/d6",
      endReason: "leaf"
    });
    // Same inputs, same plan.
    const again = contextOf(lines);
    expect(
      planRoute(again, "root", { pending: new Set(), seen: { "e4/c5": 2, "e4/e5": 2 } }).endNodeId
    ).toBe("e4/c5/Nf3/d6");
  });

  it("avoids lines already finished when nothing pending is below", () => {
    const context = contextOf(lines);
    const finished = new Set(["e4/c5/Nf3/d6"]);
    // Rotation alone would pick 1...c5 2.Nf3 d6 again; the unfinished sibling comes first.
    expect(planRoute(context, "e4", { pending: new Set(), seen: {}, finished }).endNodeId).toBe(
      "e4/c5/Nf3/Nc6"
    );
    expect(
      planRoute(context, "e4/c5/Nf3", { pending: new Set(), seen: {}, finished }).endNodeId
    ).toBe("e4/c5/Nf3/Nc6");
    // Everything below finished: the rotation still plans a line.
    const all = new Set(["e4/c5/Nf3/d6", "e4/c5/Nf3/Nc6"]);
    expect(
      planRoute(context, "e4/c5", { pending: new Set(), seen: {}, finished: all }).endNodeId
    ).toBe("e4/c5/Nf3/d6");
  });

  it("finds the move on a route", () => {
    const context = contextOf(lines);
    expect(nextOnRoute(context.lookup, "e4", "e4/e5/Nf3")?.id).toBe("e4/e5");
    expect(nextOnRoute(context.lookup, "e4/c5", "e4/e5/Nf3")).toBeNull();
    expect(nextOnRoute(context.lookup, "e4/e5/Nf3", "e4/e5/Nf3")).toBeNull();
  });
});
