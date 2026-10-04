import { describe, expect, it } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type { BestLineStep } from "./best-line-cursor";
import { alternativeGroup, alternativeTarget, type MovePosition } from "./move-alternatives";

function treeOf(pgn: string) {
  const tree = importPgnText(pgn).game.moveTree;
  const byId = new Map(tree.map((node) => [node.id, node]));
  /** The move reached by `path` (SANs) from the start, through any children. */
  const at = (...path: string[]): MoveNode => {
    let node = tree.find((item) => item.parentId === null)!;
    for (const san of path)
      node = node.children.map((id) => byId.get(id)!).find((child) => child.san === san)!;
    return node;
  };
  return { tree, at };
}

const step = (san: string): BestLineStep => ({ san, uci: san, fenAfter: `after ${san}` });

// 4. Nxe5 is an error whose BEST line is 4. Nxd4 exd4; 4. Nxd4 exd4 5. d3 and 4. c3 were also played.
const trap = treeOf(
  "1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 (4. Nxd4 exd4 5. d3) (4. c3) 4... Qg5 5. Nxf7 *"
);
const main = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nd4"];
const nxe5 = trap.at(...main, "Nxe5");
const best = [step("Nxd4"), step("exd4")];
const bestLineOf = (nodeId: string) => (nodeId === nxe5.id ? best : []);

/** Where the keys take the board, as `san` (a game move) or `best san` (a BEST line's move). */
function press(position: MovePosition, delta: 1 | -1, tree = trap.tree, lines = bestLineOf) {
  const target = alternativeTarget(tree, position, lines, delta);
  if (!target) return null;
  if (target.kind === "best") return `best ${target.cursor.moves[target.cursor.index]!.san}`;
  return tree.find((node) => node.id === target.nodeId)!.san;
}
const node = (moveNode: MoveNode): MovePosition => ({ kind: "node", nodeId: moveNode.id });
const onBest = (index: number): MovePosition => ({
  kind: "best",
  cursor: { markedNodeId: nxe5.id, anchorNodeId: nxe5.parentId!, moves: best, index }
});

describe("alternativeGroup", () => {
  it("lists the game's move, its BEST line, then the variations played instead of it", () => {
    const group = alternativeGroup(trap.tree, node(nxe5), bestLineOf)!;
    expect(group.alternatives.map((item) => item.kind)).toEqual(["line", "best", "line", "line"]);
    expect(group.current).toBe(0);
    expect(group.depth).toBe(0);
  });

  it("is the group where the line starts, for a move deeper into a variation", () => {
    const group = alternativeGroup(trap.tree, node(trap.at(...main, "Nxd4", "exd4")), bestLineOf)!;
    expect(group.current).toBe(2);
    expect(group.depth).toBe(1);
  });
});

describe("alternativeTarget", () => {
  it("cycles from a main-line error through its BEST line and its variations, and wraps around", () => {
    expect(press(node(nxe5), 1)).toBe("best Nxd4");
    expect(press(onBest(0), 1)).toBe("Nxd4");
    expect(press(node(trap.at(...main, "Nxd4")), 1)).toBe("c3");
    expect(press(node(trap.at(...main, "c3")), 1)).toBe("Nxe5");
    expect(press(node(nxe5), -1)).toBe("c3");
    expect(press(onBest(0), -1)).toBe("Nxe5");
  });

  it("keeps the depth into the line, landing on a shorter line's last move", () => {
    const exd4 = node(trap.at(...main, "Nxd4", "exd4"));
    expect(press(exd4, -1)).toBe("best exd4");
    expect(press(exd4, 1)).toBe("c3");
    expect(press(onBest(1), -1)).toBe("Qg5");
    expect(press(onBest(1), 1)).toBe("exd4");
    // Two moves in: the BEST line has two moves, so its last.
    expect(press(node(trap.at(...main, "Nxd4", "exd4", "d3")), -1)).toBe("best exd4");
    expect(press(node(trap.at(...main, "Nxd4", "exd4", "d3")), 1)).toBe("c3");
    // Further along the main line, a move has its own ply's alternatives (here none).
    expect(press(node(trap.at(...main, "Nxe5", "Qg5", "Nxf7")), 1)).toBeNull();
  });

  it("switches within the innermost line's branch point for nested variations", () => {
    const nested = treeOf("1. e4 e5 (1... c5 2. Nf3 (2. c3 d5) 2... d6) 2. Nf3 *");
    const none = () => [];
    // 2. c3 d5 branches off 1… c5: its alternatives there are 2. Nf3 (d6 at the same depth).
    expect(press(node(nested.at("e4", "c5", "c3", "d5")), 1, nested.tree, none)).toBe("d6");
    expect(press(node(nested.at("e4", "c5", "Nf3", "d6")), 1, nested.tree, none)).toBe("Nf3");
    // The first move of the outer variation: the main line's alternatives at that ply.
    expect(press(node(nested.at("e4", "c5")), 1, nested.tree, none)).toBe("e5");
    expect(press(node(nested.at("e4", "e5")), -1, nested.tree, none)).toBe("c5");
  });

  it("does nothing without alternatives", () => {
    expect(press(node(trap.at(...main, "Nxe5", "Qg5")), 1)).toBeNull();
    expect(press({ kind: "node", nodeId: "root" }, 1)).toBeNull();
    expect(press(node(nxe5), 1, trap.tree, () => [])).toBe("Nxd4");
    const single = treeOf("1. e4 e5 *");
    expect(press(node(single.at("e4", "e5")), -1, single.tree)).toBeNull();
  });
});
