import { describe, expect, it } from "vitest";
import type { MoveNode } from "../types/chess";
import type { AddFromGameScope, RepertoireNodeMeta } from "../types/repertoire";
import { applySan, START_FEN } from "./position";
import { rootPly } from "./pgn";
import {
  applyPolicy,
  extractScope,
  listOpponentMoves,
  listOwnMoves,
  pathToPosition,
  proposePolicy,
  untrainedMoveWarnings,
  type ExtractedScope
} from "./repertoire-add-from-game";
import { collectDecisions } from "./repertoire-index";
import { positionKey } from "./repertoire-position";

/** A game tree from SAN lines; shared prefixes share nodes. Ids are the SAN path (`e4/e5`). */
function gameFromLines(lines: string[][], rootFen = START_FEN): MoveNode[] {
  const root: MoveNode = {
    id: "root",
    parentId: null,
    san: null,
    uci: null,
    fenBefore: rootFen,
    fenAfter: rootFen,
    ply: rootPly(rootFen),
    nags: [],
    comment: "game intro",
    clockAfter: null,
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
          clockAfter: "0:05:00",
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

// 1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6 (2... d6 3. d4) 3. Bb5 a6
const GAME = gameFromLines([
  ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"],
  ["e4", "c5", "Nf3"],
  ["e4", "e5", "Nf3", "d6", "d4"]
]);
const byId = new Map(GAME.map((node) => [node.id, node]));
byId.get("e4/e5/Nf3")!.comment = "the main move";
byId.get("e4/e5/Nf3")!.nags = ["$1"];
byId.get("e4/e5/Nf3")!.arrows = [{ orig: "g1", dest: "f3", color: "green" }];
byId.get("e4/e5/Nf3/Nc6")!.highlights = [{ square: "c6", color: "red" }];
const SOURCE = { rootFen: START_FEN, tree: GAME };

const sans = (tree: MoveNode[]) => tree.map((node) => node.san);

describe("extractScope", () => {
  it("path: the route to the node only, with fresh pre-order ids and plies from the root", () => {
    const extracted = extractScope(SOURCE, { kind: "path", toNodeId: "e4/e5/Nf3/Nc6" });
    expect(extracted.tree.map((node) => node.id)).toEqual(["root", "n1", "n2", "n3", "n4"]);
    expect(sans(extracted.tree)).toEqual([null, "e4", "e5", "Nf3", "Nc6"]);
    expect(extracted.tree.map((node) => node.ply)).toEqual([0, 1, 2, 3, 4]);
    expect(extracted.tree.every((node) => node.children.length <= 1)).toBe(true);
    expect(extracted.sourceToChapterIds["e4/e5/Nf3"]).toBe("n3");
    expect(extracted.chapterToSourceIds.n3).toBe("e4/e5/Nf3");
    expect(extracted.contextNodeIds).toEqual([]);
    expect(extracted.startNodeId).toBeNull();
    const nf3 = extracted.tree[3];
    expect(nf3).toMatchObject({
      comment: "the main move",
      nags: ["$1"],
      arrows: [{ orig: "g1", dest: "f3", color: "green" }],
      clockAfter: null
    });
    expect(extracted.tree[4].highlights).toEqual([{ square: "c6", color: "red" }]);
    expect(extracted.tree[0]).toMatchObject({ comment: "game intro", parentId: null, uci: null });
  });

  it("subtree/original: the prefix as context, then everything below the node", () => {
    const extracted = extractScope(SOURCE, {
      kind: "subtree",
      fromNodeId: "e4/e5/Nf3",
      root: "original"
    });
    expect(sans(extracted.tree)).toEqual([null, "e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "d6", "d4"]);
    expect(extracted.contextNodeIds).toEqual(["e4", "e4/e5", "e4/e5/Nf3"]);
    expect(extracted.startNodeId).toBe(extracted.sourceToChapterIds["e4/e5/Nf3"]);
    // The sibling line 1... c5 isn't copied.
    expect(extracted.sourceToChapterIds["e4/c5"]).toBeUndefined();
    const nf3 = extracted.tree.find((node) => node.id === extracted.startNodeId)!;
    expect(nf3.children).toHaveLength(2);
  });

  it("subtree/original from the root copies the whole tree with no context", () => {
    const extracted = extractScope(SOURCE, {
      kind: "subtree",
      fromNodeId: "root",
      root: "original"
    });
    expect(extracted.tree).toHaveLength(GAME.length);
    expect(extracted.contextNodeIds).toEqual([]);
    expect(extracted.startNodeId).toBeNull();
  });

  it("subtree/standalone re-roots a Black-to-move position with plies from its FEN", () => {
    const extracted = extractScope(SOURCE, {
      kind: "subtree",
      fromNodeId: "e4/e5/Nf3",
      root: "standalone"
    });
    const nf3 = byId.get("e4/e5/Nf3")!;
    expect(extracted.rootFen).toBe(nf3.fenAfter);
    const root = extracted.tree[0];
    expect(root).toMatchObject({
      id: "root",
      parentId: null,
      san: null,
      uci: null,
      nags: [],
      fenBefore: nf3.fenAfter,
      fenAfter: nf3.fenAfter,
      comment: "the main move"
    });
    // 2. Nf3 was ply 3, so the root is ply 3 (Black to move) and 2... Nc6 is ply 4.
    expect(root.ply).toBe(3);
    expect(sans(extracted.tree)).toEqual([null, "Nc6", "Bb5", "a6", "d6", "d4"]);
    expect(extracted.tree.slice(1).map((node) => node.ply)).toEqual([4, 5, 6, 4, 5]);
    expect(extracted.sourceToChapterIds["e4/e5/Nf3"]).toBe("root");
    expect(extracted.contextNodeIds).toEqual([]);
    expect(listOwnMoves("black", extracted).map((move) => move.path)).toEqual([
      "2... Nc6",
      "2... Nc6 3. Bb5 a6",
      "2... d6"
    ]);
  });

  it("standalone from a custom Black-to-move root counts plies from that FEN", () => {
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
    const game = gameFromLines([["Bb5", "a6", "Ba4"]], fen);
    const extracted = extractScope(
      { rootFen: fen, tree: game },
      { kind: "subtree", fromNodeId: "Bb5", root: "standalone" }
    );
    expect(extracted.tree.map((node) => node.ply)).toEqual([5, 6, 7]);
  });

  it("whole-game copies every node", () => {
    const extracted = extractScope(SOURCE, { kind: "whole-game" });
    expect(extracted.tree).toHaveLength(GAME.length);
    expect(new Set(extracted.tree.map((node) => node.id)).size).toBe(GAME.length);
    expect(Object.keys(extracted.sourceToChapterIds)).toHaveLength(GAME.length);
  });

  it("rejects unknown node ids", () => {
    expect(() => extractScope(SOURCE, { kind: "path", toNodeId: "nope" })).toThrow(
      'Invalid scope: node "nope" is not in the game'
    );
    expect(() =>
      extractScope(SOURCE, { kind: "subtree", fromNodeId: "nope", root: "standalone" })
    ).toThrow('Invalid scope: node "nope" is not in the game');
    expect(() =>
      extractScope({ rootFen: START_FEN, tree: GAME.slice(1) }, { kind: "whole-game" })
    ).toThrow('Invalid source tree: node "root" is missing');
  });
});

describe("proposePolicy / applyPolicy", () => {
  it("an opening excerpt includes own first choices along covered routes and covers replies", () => {
    const scope: AddFromGameScope = { kind: "subtree", fromNodeId: "root", root: "original" };
    const extracted = extractScope(SOURCE, scope);
    const policy = proposePolicy("white", extracted, scope, "opening");
    expect(policy.includedNodeIds).toEqual([
      "e4",
      "e4/e5/Nf3",
      "e4/e5/Nf3/Nc6/Bb5",
      "e4/e5/Nf3/d6/d4",
      "e4/c5/Nf3"
    ]);
    expect(policy.coveredNodeIds).toEqual([
      "e4/e5",
      "e4/e5/Nf3/Nc6",
      "e4/e5/Nf3/Nc6/Bb5/a6",
      "e4/e5/Nf3/d6",
      "e4/c5"
    ]);
  });

  it("own-side alternatives and their subtrees stay reference", () => {
    const game = gameFromLines([
      ["e4", "e5", "Nf3"],
      ["d4", "d5"]
    ]);
    const scope: AddFromGameScope = { kind: "whole-game" };
    const extracted = extractScope(
      { rootFen: START_FEN, tree: game },
      { kind: "subtree", fromNodeId: "root", root: "original" }
    );
    const policy = proposePolicy("white", extracted, { kind: "path", toNodeId: "e4" }, "opening");
    expect(policy.includedNodeIds).toEqual(["e4", "e4/e5/Nf3"]);
    expect(policy.coveredNodeIds).toEqual(["e4/e5"]);
    expect(proposePolicy("white", extracted, scope, "opening")).toEqual({
      includedNodeIds: [],
      coveredNodeIds: []
    });
  });

  it("a reference chapter or the whole game proposes nothing", () => {
    const scope: AddFromGameScope = { kind: "path", toNodeId: "e4/e5/Nf3" };
    const extracted = extractScope(SOURCE, scope);
    expect(proposePolicy("white", extracted, scope, "reference")).toEqual({
      includedNodeIds: [],
      coveredNodeIds: []
    });
    const whole = extractScope(SOURCE, { kind: "whole-game" });
    expect(proposePolicy("white", whole, { kind: "whole-game" }, "opening")).toEqual({
      includedNodeIds: [],
      coveredNodeIds: []
    });
  });

  it("subtree/original leaves the context out and starts training at the selected node", () => {
    const scope: AddFromGameScope = { kind: "subtree", fromNodeId: "e4/e5/Nf3", root: "original" };
    const extracted = extractScope(SOURCE, scope);
    const policy = proposePolicy("black", extracted, scope, "opening");
    expect(policy.includedNodeIds).toEqual(["e4/e5/Nf3/Nc6", "e4/e5/Nf3/Nc6/Bb5/a6"]);
    expect(policy.coveredNodeIds).toEqual(["e4/e5/Nf3/Nc6/Bb5"]);
    const meta = applyPolicy(extracted, policy);
    const id = (source: string) => extracted.sourceToChapterIds[source];
    expect(meta[id("e4")]).toEqual({ edge: "covered" });
    expect(meta[id("e4/e5")]).toEqual({ edge: "covered" });
    expect(meta[id("e4/e5/Nf3")]).toEqual({ edge: "covered", trainingStart: true });
    expect(meta[id("e4/e5/Nf3/Nc6")]).toEqual({ edge: "included" });
    expect(meta[id("e4/e5/Nf3/Nc6/Bb5/a6")]).toEqual({ edge: "included" });
    expect(meta[id("e4/e5/Nf3/d6")]).toEqual({ edge: "reference" });
    expect(meta.root).toBeUndefined();

    // Only the selected position trains: the context's own moves never become decisions.
    const decisions = collectDecisions("black", [
      {
        id: "c",
        kind: "opening",
        enabled: true,
        sortOrder: 0,
        tree: extracted.tree,
        nodeMeta: meta
      }
    ]);
    expect([...decisions.values()].map((decision) => [...decision.acceptedUcis])).toEqual([
      ["b8c6"],
      ["a7a6"]
    ]);
    expect(listOwnMoves("black", extracted).map((move) => move.nodeId)).toEqual([
      "e4/e5/Nf3/Nc6",
      "e4/e5/Nf3/Nc6/Bb5/a6",
      "e4/e5/Nf3/d6"
    ]);
  });

  it("applyPolicy keys metadata through a given id map and skips unmapped nodes", () => {
    const scope: AddFromGameScope = { kind: "path", toNodeId: "e4/e5" };
    const extracted = extractScope(SOURCE, scope);
    const meta = applyPolicy(
      extracted,
      { includedNodeIds: ["e4"], coveredNodeIds: [] },
      { e4: "x1" }
    );
    expect({ ...meta }).toEqual({ x1: { edge: "included" } });
  });
});

describe("listOwnMoves", () => {
  it("lists the player's moves in route order with numbered paths", () => {
    const extracted = extractScope(SOURCE, { kind: "whole-game" });
    expect(listOwnMoves("white", extracted)).toEqual([
      { nodeId: "e4", san: "e4", uci: "e2e4", ply: 1, path: "1. e4" },
      { nodeId: "e4/e5/Nf3", san: "Nf3", uci: "g1f3", ply: 3, path: "1. e4 e5 2. Nf3" },
      {
        nodeId: "e4/e5/Nf3/Nc6/Bb5",
        san: "Bb5",
        uci: "f1b5",
        ply: 5,
        path: "1. e4 e5 2. Nf3 Nc6 3. Bb5"
      },
      {
        nodeId: "e4/e5/Nf3/d6/d4",
        san: "d4",
        uci: "d2d4",
        ply: 5,
        path: "1. e4 e5 2. Nf3 d6 3. d4"
      },
      { nodeId: "e4/c5/Nf3", san: "Nf3", uci: "g1f3", ply: 3, path: "1. e4 c5 2. Nf3" }
    ]);
  });
});

describe("listOpponentMoves / pathToPosition", () => {
  it("lists opponent moves in route order, leaving the context out", () => {
    const extracted = extractScope(SOURCE, {
      kind: "subtree",
      fromNodeId: "e4/e5/Nf3",
      root: "original"
    });
    expect(listOpponentMoves("white", extracted).map((move) => move.nodeId)).toEqual([
      "e4/e5/Nf3/Nc6",
      "e4/e5/Nf3/Nc6/Bb5/a6",
      "e4/e5/Nf3/d6"
    ]);
    expect(listOpponentMoves("black", extracted).map((move) => move.path)).toEqual([
      "1. e4 e5 2. Nf3 Nc6 3. Bb5",
      "1. e4 e5 2. Nf3 d6 3. d4"
    ]);
  });

  it("gives the SAN route to a position, empty for the root and null when unreached", () => {
    const extracted = extractScope(SOURCE, { kind: "whole-game" });
    const key = (id: string) => positionKey(byId.get(id)!.fenAfter);
    expect(pathToPosition(extracted, key("e4/e5/Nf3/d6"))).toBe("1. e4 e5 2. Nf3 d6");
    expect(pathToPosition(extracted, positionKey(START_FEN))).toBe("");
    const line = extractScope(SOURCE, { kind: "path", toNodeId: "e4" });
    expect(pathToPosition(line, key("e4/c5"))).toBeNull();
  });
});

describe("untrainedMoveWarnings", () => {
  const chapterOf = (extracted: ExtractedScope, nodeMeta: Record<string, RepertoireNodeMeta>) => ({
    kind: "opening" as const,
    enabled: true,
    tree: extracted.tree,
    nodeMeta
  });
  const chosen = (extracted: ExtractedScope, sourceIds: string[]) =>
    listOwnMoves("white", extracted)
      .filter((move) => sourceIds.includes(move.nodeId))
      .map((move) => ({
        chapterNodeId: extracted.sourceToChapterIds[move.nodeId],
        san: move.san,
        path: move.path
      }));

  it("counts moves that train and names those below an unaccepted move", () => {
    const extracted = extractScope(SOURCE, { kind: "whole-game" });
    const policy = {
      includedNodeIds: ["e4/e5/Nf3", "e4/e5/Nf3/Nc6/Bb5"],
      coveredNodeIds: ["e4/e5", "e4/e5/Nf3/Nc6"]
    };
    // 1. e4 stays unticked (reference), so nothing below it trains.
    const result = untrainedMoveWarnings(
      chapterOf(extracted, applyPolicy(extracted, policy)),
      chosen(extracted, policy.includedNodeIds)
    );
    expect(result.trained).toBe(0);
    expect(result.warnings).toEqual([
      "2 chosen moves won't be trained: Nf3 at 1. e4 e5 2. Nf3, Bb5 at 1. e4 e5 2. Nf3 Nc6 3. Bb5 are below an unaccepted move"
    ]);
    const accepted = { ...policy, includedNodeIds: ["e4", ...policy.includedNodeIds] };
    const all = untrainedMoveWarnings(
      chapterOf(extracted, applyPolicy(extracted, accepted)),
      chosen(extracted, accepted.includedNodeIds)
    );
    expect(all).toEqual({ trained: 3, warnings: [] });
  });

  it("reports moves before a training start and a move that starts a line", () => {
    const extracted = extractScope(SOURCE, { kind: "whole-game" });
    const policy = {
      includedNodeIds: ["e4", "e4/e5/Nf3", "e4/e5/Nf3/Nc6/Bb5"],
      coveredNodeIds: ["e4/e5", "e4/e5/Nf3/Nc6"]
    };
    const meta = applyPolicy(extracted, policy);
    meta[extracted.sourceToChapterIds["e4/e5/Nf3"]].trainingStart = true;
    const result = untrainedMoveWarnings(
      chapterOf(extracted, meta),
      chosen(extracted, policy.includedNodeIds)
    );
    expect(result.trained).toBe(1);
    expect(result.warnings).toEqual([
      "1 chosen move won't be trained: they come before the chapter's training start",
      "1 chosen move won't be trained: the chapter's training starts after them"
    ]);
  });
});
