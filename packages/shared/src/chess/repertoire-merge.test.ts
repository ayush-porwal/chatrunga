import { describe, expect, it } from "vitest";
import type { MoveNode } from "../types/chess";
import type { RepertoireChapter, RepertoireNodeMeta } from "../types/repertoire";
import { fenAfterUci, START_FEN } from "./position";
import { rootPly } from "./pgn";
import { collectDecisions } from "./repertoire-index";
import { mergeIntoChapter } from "./repertoire-merge";

/** A tree from UCI lines; shared prefixes share nodes; ids `prefix` + counter in creation order. */
function treeOf(lines: string[][], prefix: string, rootFen = START_FEN): MoveNode[] {
  const root: MoveNode = {
    id: "root",
    parentId: null,
    san: null,
    uci: null,
    fenBefore: rootFen,
    fenAfter: rootFen,
    ply: rootPly(rootFen),
    nags: [],
    comment: null,
    arrows: [],
    highlights: [],
    children: []
  };
  const tree = [root];
  let next = 1;
  for (const line of lines) {
    let parent = root;
    for (const uci of line) {
      let child = parent.children
        .map((id) => tree.find((node) => node.id === id)!)
        .find((node) => node.uci === uci);
      if (!child) {
        child = {
          id: `${prefix}${next++}`,
          parentId: parent.id,
          san: uci,
          uci,
          fenBefore: parent.fenAfter,
          fenAfter: fenAfterUci(parent.fenAfter, uci)!,
          ply: parent.ply + 1,
          nags: [],
          comment: null,
          arrows: [],
          highlights: [],
          children: []
        };
        parent.children.push(child.id);
        tree.push(child);
      }
      parent = child;
    }
  }
  return tree;
}

function chapterOf(tree: MoveNode[], nodeMeta: Record<string, RepertoireNodeMeta> = {}) {
  const chapter: RepertoireChapter = {
    id: "c1",
    title: "Chapter",
    sortOrder: 0,
    kind: "opening",
    enabled: true,
    rootFen: tree[0].fenAfter,
    revision: 1,
    nodeCount: tree.length - 1,
    dueCount: 0,
    headers: {},
    tree,
    nodeMeta
  };
  return chapter;
}

const node = (tree: MoveNode[], id: string) => tree.find((item) => item.id === id)!;

describe("mergeIntoChapter", () => {
  it("keeps existing nodes and comments and appends new branches with fresh ids", () => {
    const existing = treeOf([["e2e4", "e7e5", "g1f3"]], "n");
    node(existing, "n2").comment = "existing comment";
    const incoming = treeOf(
      [
        ["e2e4", "e7e5", "g1f3", "b8c6"],
        ["e2e4", "c7c5"]
      ],
      "x"
    );
    node(incoming, "x2").comment = "incoming comment";
    node(incoming, "x3").comment = "fills an empty one";
    node(incoming, "x4").arrows = [{ orig: "b8", dest: "c6", color: "green" }];
    const result = mergeIntoChapter(chapterOf(existing), {
      rootFen: START_FEN,
      tree: incoming,
      nodeMeta: { x4: { edge: "covered" }, x5: { edge: "covered" } }
    });
    expect(result.added).toBe(2);
    expect(result.alreadyPresent).toBe(3);
    expect({ ...result.idMap }).toEqual({
      root: "root",
      x1: "n1",
      x2: "n2",
      x3: "n3",
      x4: "n4",
      x5: "n5"
    });
    const tree = result.chapter.tree;
    expect(node(tree, "n2").comment).toBe("existing comment");
    expect(node(tree, "n3").comment).toBe("fills an empty one");
    expect(node(tree, "n4")).toMatchObject({ parentId: "n3", uci: "b8c6", ply: 4 });
    expect(node(tree, "n4").arrows).toEqual([{ orig: "b8", dest: "c6", color: "green" }]);
    expect(node(tree, "n1").children).toEqual(["n2", "n5"]);
    expect(result.chapter.nodeMeta.n4).toEqual({ edge: "covered" });
    expect(result.chapter.nodeCount).toBe(5);
    // The input chapter is left untouched.
    expect(existing).toHaveLength(4);
    expect(node(existing, "n1").children).toEqual(["n2"]);
  });

  it("is idempotent: merging the same material again adds nothing", () => {
    const existing = chapterOf(treeOf([["e2e4"]], "n"));
    const incoming = {
      rootFen: START_FEN,
      tree: treeOf([["e2e4", "e7e5"], ["d2d4"]], "x"),
      nodeMeta: {}
    };
    const first = mergeIntoChapter(existing, incoming);
    expect(first.added).toBe(2);
    const second = mergeIntoChapter(first.chapter, incoming);
    expect(second.added).toBe(0);
    expect(second.alreadyPresent).toBe(3);
    expect(second.chapter.tree).toEqual(first.chapter.tree);
  });

  it("allocates n-ids beyond the largest and skips taken ones; new moves default to reference", () => {
    const existing = treeOf([["e2e4"]], "n");
    existing[1].id = "n7";
    existing[0].children = ["n7"];
    const result = mergeIntoChapter(chapterOf(existing), {
      rootFen: START_FEN,
      tree: treeOf([["d2d4"]], "x"),
      nodeMeta: {}
    });
    expect(result.idMap.x1).toBe("n8");
    expect(result.chapter.nodeMeta.n8).toEqual({ edge: "reference" });
  });

  it("upgrades a matched reference edge only when allowed, and never downgrades", () => {
    const existing = treeOf([["e2e4", "e7e5"], ["d2d4"]], "n");
    const meta: Record<string, RepertoireNodeMeta> = {
      n1: { edge: "reference" },
      n2: { edge: "covered", trainingStop: true },
      n3: { edge: "reference" }
    };
    const incoming = treeOf([["e2e4", "e7e5"], ["d2d4"]], "x");
    const result = mergeIntoChapter(chapterOf(existing, meta), {
      rootFen: START_FEN,
      tree: incoming,
      nodeMeta: {
        x1: { edge: "included" },
        x2: { edge: "reference" },
        x3: { edge: "included" }
      },
      upgradeNodeIds: ["x1", "x2"]
    });
    expect(result.chapter.nodeMeta.n1).toEqual({ edge: "included" });
    expect(result.chapter.nodeMeta.n2).toEqual({ edge: "covered", trainingStop: true });
    // Not in upgradeNodeIds: stays reference.
    expect(result.chapter.nodeMeta.n3).toEqual({ edge: "reference" });
  });

  it("applies an incoming training start only when the chapter already marks one", () => {
    const incoming = {
      rootFen: START_FEN,
      tree: treeOf([["d2d4"]], "x"),
      nodeMeta: { x1: { edge: "covered" as const, trainingStart: true } }
    };
    const plain = mergeIntoChapter(chapterOf(treeOf([["e2e4"]], "n")), incoming);
    expect(plain.chapter.nodeMeta[plain.idMap.x1]).toEqual({ edge: "covered" });
    const marked = mergeIntoChapter(
      chapterOf(treeOf([["e2e4"]], "n"), { n1: { edge: "included", trainingStart: true } }),
      incoming
    );
    expect(marked.chapter.nodeMeta[marked.idMap.x1]).toEqual({
      edge: "covered",
      trainingStart: true
    });
  });

  it("starts a new line that holds included moves when the chapter already marks a start", () => {
    // The chapter trains from 1. e4 e5 2. Nf3; a new 1. d4 line would otherwise stay before it.
    const existing = treeOf([["e2e4", "e7e5", "g1f3"]], "n");
    const meta: Record<string, RepertoireNodeMeta> = {
      n1: { edge: "included" },
      n2: { edge: "covered" },
      n3: { edge: "included", trainingStart: true }
    };
    const incoming = treeOf(
      [
        ["d2d4", "d7d5", "c2c4"],
        ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"],
        ["c2c4", "e7e5"]
      ],
      "x"
    );
    const result = mergeIntoChapter(chapterOf(existing, meta), {
      rootFen: START_FEN,
      tree: incoming,
      nodeMeta: {
        x1: { edge: "included" },
        x2: { edge: "covered" },
        x3: { edge: "included" },
        x4: { edge: "included" },
        x5: { edge: "covered" },
        x6: { edge: "included" },
        x7: { edge: "covered" },
        x8: { edge: "included" },
        x9: { edge: "reference" },
        x10: { edge: "covered" }
      }
    });
    const metaOf = (id: string) => result.chapter.nodeMeta[result.idMap[id]];
    // The first new node of the d4 route is the start; the nodes below it are not.
    expect(metaOf("x1")).toEqual({ edge: "included", trainingStart: true });
    expect(metaOf("x2")).toEqual({ edge: "covered" });
    expect(metaOf("x3")).toEqual({ edge: "included" });
    // Below the existing start: no new start.
    expect(metaOf("x7")).toEqual({ edge: "covered" });
    // No included move follows: left as is.
    expect(metaOf("x9")).toEqual({ edge: "reference" });
    const decisions = collectDecisions("white", [result.chapter]);
    const d4Position = node(result.chapter.tree, result.idMap.x2).fenAfter;
    expect([...decisions.values()].some((decision) => decision.fen === d4Position)).toBe(true);
  });

  it("leaves a chapter without a training start unmarked", () => {
    const result = mergeIntoChapter(chapterOf(treeOf([["e2e4"]], "n")), {
      rootFen: START_FEN,
      tree: treeOf([["d2d4", "d7d5", "c2c4"]], "x"),
      nodeMeta: { x1: { edge: "included" }, x2: { edge: "covered" }, x3: { edge: "included" } }
    });
    expect(result.chapter.nodeMeta[result.idMap.x1]).toEqual({ edge: "included" });
  });

  it("upgrades a covered own move to included when the incoming edge is included", () => {
    const existing = treeOf([["d2d4", "d7d5"]], "n");
    const meta: Record<string, RepertoireNodeMeta> = {
      n1: { edge: "covered" },
      n2: { edge: "covered" }
    };
    const before = collectDecisions("white", [chapterOf(existing, meta)]);
    expect(before.size).toBe(0);
    const result = mergeIntoChapter(chapterOf(existing, meta), {
      rootFen: START_FEN,
      tree: treeOf([["d2d4", "d7d5", "c2c4"]], "x"),
      nodeMeta: { x1: { edge: "included" }, x2: { edge: "covered" }, x3: { edge: "reference" } },
      upgradeNodeIds: ["x1", "x2"]
    });
    expect(result.chapter.nodeMeta.n1).toEqual({ edge: "included" });
    expect(result.chapter.nodeMeta.n2).toEqual({ edge: "covered" });
    const after = collectDecisions("white", [result.chapter]);
    expect([...after.values()].map((decision) => decision.fen)).toEqual([START_FEN]);
    // Not in upgradeNodeIds: stays covered.
    const kept = mergeIntoChapter(chapterOf(existing, meta), {
      rootFen: START_FEN,
      tree: treeOf([["d2d4"]], "x"),
      nodeMeta: { x1: { edge: "included" } },
      upgradeNodeIds: []
    });
    expect(kept.chapter.nodeMeta.n1).toEqual({ edge: "covered" });
  });

  it("a covered own move accepted before the chapter's training start trains from its position", () => {
    // "This branch · keep moves before" at 1... d5: d4 and d5 are covered context, d5 the start.
    const existing = treeOf([["d2d4", "d7d5", "c2c4"]], "n");
    const meta: Record<string, RepertoireNodeMeta> = {
      n1: { edge: "covered" },
      n2: { edge: "covered", trainingStart: true },
      n3: { edge: "included" }
    };
    const result = mergeIntoChapter(chapterOf(existing, meta), {
      rootFen: START_FEN,
      tree: treeOf([["d2d4", "d7d5", "c2c4"]], "x"),
      nodeMeta: { x1: { edge: "included" }, x2: { edge: "covered" }, x3: { edge: "included" } },
      upgradeNodeIds: ["x1", "x2", "x3"]
    });
    expect(result.chapter.nodeMeta.n1).toEqual({ edge: "included" });
    expect(result.chapter.nodeMeta.root).toEqual({ edge: "included", trainingStart: true });
    const decisions = collectDecisions("white", [result.chapter]);
    const root = [...decisions.values()].find((decision) => decision.fen === START_FEN);
    expect(root && [...root.acceptedUcis]).toEqual(["d2d4"]);
    expect(decisions.size).toBe(2);
    // Already under the start: nothing moves.
    const below = mergeIntoChapter(
      chapterOf(existing, { ...meta, root: { edge: "included", trainingStart: true } }),
      {
        rootFen: START_FEN,
        tree: treeOf([["d2d4"]], "x"),
        nodeMeta: { x1: { edge: "included" } }
      }
    );
    expect(below.chapter.nodeMeta.n2).toEqual({ edge: "covered", trainingStart: true });
  });

  it("a new included first move trains from its position when no other move would start", () => {
    const existing = treeOf([["e2e4", "e7e5", "g1f3"]], "n");
    const meta: Record<string, RepertoireNodeMeta> = {
      n1: { edge: "covered" },
      n2: { edge: "covered", trainingStart: true },
      n3: { edge: "included" }
    };
    const result = mergeIntoChapter(chapterOf(existing, meta), {
      rootFen: START_FEN,
      tree: treeOf([["d2d4", "d7d5", "c2c4"]], "x"),
      nodeMeta: { x1: { edge: "included" }, x2: { edge: "covered" }, x3: { edge: "included" } }
    });
    expect(result.chapter.nodeMeta.root).toEqual({ edge: "included", trainingStart: true });
    expect(result.chapter.nodeMeta[result.idMap.x1]).toEqual({ edge: "included" });
    const decisions = collectDecisions("white", [result.chapter]);
    const root = [...decisions.values()].find((decision) => decision.fen === START_FEN);
    expect(root && [...root.acceptedUcis]).toEqual(["d2d4"]);
  });

  it("accepting a covered move doesn't start training the chapter's other moves before its start", () => {
    // 1. e4 is included but trains only from 2... Nc6; 1. d4 is covered context.
    const existing = treeOf([["e2e4", "e7e5", "g1f3", "b8c6"], ["d2d4"]], "n");
    const meta: Record<string, RepertoireNodeMeta> = {
      n1: { edge: "included" },
      n2: { edge: "covered" },
      n3: { edge: "included" },
      n4: { edge: "covered", trainingStart: true },
      n5: { edge: "covered" }
    };
    const result = mergeIntoChapter(chapterOf(existing, meta), {
      rootFen: START_FEN,
      tree: treeOf([["d2d4"]], "x"),
      nodeMeta: { x1: { edge: "included" } }
    });
    expect(result.chapter.nodeMeta.n5).toEqual({ edge: "included" });
    expect(result.chapter.nodeMeta.root?.trainingStart).toBeUndefined();
    const decisions = collectDecisions("white", [result.chapter]);
    expect([...decisions.values()].some((decision) => decision.fen === START_FEN)).toBe(false);
  });

  it("matches a root with different move counters and renumbers new moves from the chapter", () => {
    const later = START_FEN.replace(" 0 1", " 0 5");
    const result = mergeIntoChapter(chapterOf(treeOf([], "n")), {
      rootFen: later,
      tree: treeOf([["e2e4"]], "x", later),
      nodeMeta: {}
    });
    expect(node(result.chapter.tree, result.idMap.x1)).toMatchObject({ ply: 1 });
    expect(node(result.chapter.tree, result.idMap.x1).fenAfter.endsWith(" 0 1")).toBe(true);
  });

  it("throws when the roots are different positions", () => {
    const other = fenAfterUci(START_FEN, "e2e4")!;
    expect(() =>
      mergeIntoChapter(chapterOf(treeOf([], "n")), {
        rootFen: other,
        tree: treeOf([], "x", other),
        nodeMeta: {}
      })
    ).toThrow(
      "Invalid destination: the selected material starts at a different position than the chapter"
    );
  });
});
