import { describe, expect, it } from "vitest";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import { buildTreeModel, variationMoveNumber, variationText } from "./move-tree-model";

function node(id: string, parentId: string | null, ply: number, children: string[] = []): MoveNode {
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

/** Each variation row as it reads: its depth, then its moves with their numbers. */
function rowsOf(pgn: string) {
  const { game } = importPgnText(pgn);
  const model = buildTreeModel(game.moveTree);
  const sanOf = (id: string) => game.moveTree.find((item) => item.id === id)?.san;
  return new Map(
    [...model.variationsByMove].map(([moveId, rows]) => [
      sanOf(moveId),
      rows.map((row) => `${row.depth}: ${variationText(row.moves)}`)
    ])
  );
}

describe("buildTreeModel", () => {
  it("keeps the first child as the main line and draws each other child as a variation row under the move it replaces", () => {
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
    // The line from 1. alt follows its first children; 1… nestedAlt branches off it, one deeper.
    const rows = model.variationsByMove.get("main") ?? [];
    expect(rows.map((row) => [row.depth, row.moves.map((move) => move.node.id)])).toEqual([
      [0, ["alt", "altReply"]],
      [1, ["nestedAlt", "deep"]]
    ]);
    expect([...model.variationsByMove.keys()]).toEqual(["main"]);
  });

  it("numbers a variation's moves as they read: `9.` before White's, `9…` before Black's first", () => {
    const rows = rowsOf("1. e4 e5 2. Nf3 (2. Bc4 Nf6 3. d3) 2... Nc6 (2... d6 3. d4 exd4) *");
    expect(rows.get("Nf3")).toEqual(["0: 2. Bc4 Nf6 3. d3"]);
    expect(rows.get("Nc6")).toEqual(["0: 2… d6 3. d4 exd4"]);
  });

  it("lists the alternatives at one point in order, each followed by the rows nested in it, at any depth", () => {
    const rows = rowsOf(
      "1. e4 e5 2. Nf3 (2. Bc4 Nf6 (2... Bc5 3. c3 (3. Qh5 Qe7) 3... Nf6) 3. d3) (2. d4 exd4) 2... Nc6 *"
    );
    expect(rows.get("Nf3")).toEqual([
      "0: 2. Bc4 Nf6 3. d3",
      "1: 2… Bc5 3. c3 Nf6",
      "2: 3. Qh5 Qe7",
      "0: 2. d4 exd4"
    ]);
  });

  it("numbers lines from the position's own move number", () => {
    const rows = rowsOf(
      '[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/8/4K3 b - - 0 42"]\n\n42... Kf7 (42... Kd7 43. Kd2) 43. Ke2 *'
    );
    expect(rows.get("Kf7")).toEqual(["0: 42… Kd7 43. Kd2"]);
  });

  it("follows very long variation lines iteratively, in one row", () => {
    const depth = 1_200;
    const nodes: MoveNode[] = [
      node("root", null, 0, ["main", "alt"]),
      node("alt", "root", 1, ["alt-0"])
    ];
    nodes.push(node("main", "root", 1));
    let parentId = "alt";
    for (let index = 0; index < depth; index += 1) {
      const id = `alt-${index}`;
      const childId = index + 1 < depth ? `alt-${index + 1}` : "";
      nodes.push(node(id, parentId, index + 2, childId ? [childId] : []));
      parentId = id;
    }

    const rows = buildTreeModel(nodes).variationsByMove.get("main") ?? [];

    expect(rows).toHaveLength(1);
    expect(rows[0].moves).toHaveLength(depth + 1);
  });

  it("nests deeply branching variations iteratively", () => {
    const depth = 1_200;
    // Each variation move has a continuation and an alternative: every alternative nests deeper.
    const nodes: MoveNode[] = [node("root", null, 0, ["main", "v-0"]), node("main", "root", 1)];
    for (let index = 0; index < depth; index += 1) {
      const next = index + 1 < depth ? [`c-${index}`, `v-${index + 1}`] : [];
      nodes.push(node(`v-${index}`, index ? `v-${index - 1}` : "root", index + 1, next));
      if (next.length) nodes.push(node(`c-${index}`, `v-${index}`, index + 2));
    }

    const rows = buildTreeModel(nodes).variationsByMove.get("main") ?? [];

    expect(rows).toHaveLength(depth);
    expect(rows.at(-1)?.depth).toBe(depth - 1);
  });

  it("gives a move without SAN (a collapsed branch's placeholder) no number", () => {
    const placeholder = { ...node("more", "root", 1), san: null };
    expect(variationMoveNumber(placeholder, 0)).toBeNull();
  });

  it("pairs rows by move number when the game starts with Black", () => {
    const { game } = importPgnText(
      '[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/8/4K3 b - - 0 42"]\n\n42... Kf7 43. Ke2 Ke6 *'
    );
    const rows = buildTreeModel(game.moveTree).mainline.map((row) => ({
      number: row.number,
      white: row.white?.san,
      black: row.black?.san
    }));
    expect(rows).toEqual([
      { number: 42, white: undefined, black: "Kf7" },
      { number: 43, white: "Ke2", black: "Ke6" }
    ]);
  });
});
