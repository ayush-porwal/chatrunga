import { describe, expect, it } from "vitest";
import type { MoveNode } from "../types/chess";
import { promoteChild, promoteToMainline, promotionTarget } from "./move-tree-promote";
import { importPgnText } from "./pgn";

/** The tree as PGN reads it, without numbers: `e4 c5 (e5 Nf3) Nf3`. */
function lines(tree: readonly MoveNode[]): string {
  const byId = new Map(tree.map((node) => [node.id, node]));
  const san = (id: string) => byId.get(id)?.san ?? "?";
  const walk = (id: string): string[] => {
    const parts: string[] = [];
    let node = byId.get(id);
    while (node?.children[0]) {
      const [main, ...others] = node.children;
      parts.push(
        san(main),
        ...others.map((other) => `(${[san(other), ...walk(other)].join(" ")})`)
      );
      node = byId.get(main);
    }
    return parts;
  };
  return walk(tree.find((node) => node.parentId === null)!.id).join(" ");
}

const tree = (pgn: string) => importPgnText(pgn).game.moveTree;
const idOf = (nodes: readonly MoveNode[], san: string) =>
  nodes.find((node) => node.san === san)!.id;

describe("promoteToMainline", () => {
  it("makes a variation the main line, and the old main line its first variation", () => {
    const nodes = tree("1. e4 e5 (1... c5 2. Nf3) (1... e6) 2. Nf3 *");
    const promoted = promoteToMainline(nodes, idOf(nodes, "c5"))!;
    expect(lines(promoted)).toBe("e4 c5 (e5 Nf3) (e6) Nf3");
  });

  it("promotes from any move of the variation, not just its first", () => {
    const nodes = tree("1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 *");
    const d6 = nodes.find((node) => node.san === "d6")!.id;
    expect(lines(promoteToMainline(nodes, d6)!)).toBe("e4 c5 (e5 Nf3) Nf3 d6");
  });

  it("brings a nested variation up to the main line at every point it branches", () => {
    const nodes = tree("1. e4 e5 (1... c5 2. Nf3 (2. c3 d5) 2... d6) 2. Nf3 *");
    const promoted = promoteToMainline(nodes, idOf(nodes, "d5"))!;
    expect(lines(promoted)).toBe("e4 c5 (e5 Nf3) c3 (Nf3 d6) d5");
  });

  it("keeps every move and its id, so the selected move stays selected", () => {
    const nodes = tree("1. e4 e5 (1... c5 2. Nf3) 2. Nf3 *");
    const promoted = promoteToMainline(nodes, idOf(nodes, "c5"))!;
    expect(promoted.map((node) => node.id).sort()).toEqual(nodes.map((node) => node.id).sort());
    expect(promoted.find((node) => node.san === "c5")).toEqual(
      nodes.find((node) => node.san === "c5")
    );
  });

  it("is null for a main-line move, the root or an unknown move", () => {
    const nodes = tree("1. e4 e5 (1... c5) 2. Nf3 *");
    expect(promoteToMainline(nodes, idOf(nodes, "Nf3"))).toBeNull();
    expect(promoteToMainline(nodes, "root")).toBeNull();
    expect(promoteToMainline(nodes, "missing")).toBeNull();
  });
});

describe("one-step promotion (Study)", () => {
  it("moves the nearest variation up one level only", () => {
    const nodes = tree("1. e4 e5 (1... c5 2. Nf3 (2. c3 d5) 2... d6) 2. Nf3 *");
    const target = promotionTarget(nodes, idOf(nodes, "d5"));
    expect(target).toBe(idOf(nodes, "c3"));
    expect(lines(promoteChild(nodes, target!))).toBe("e4 e5 (c5 c3 (Nf3 d6) d5) Nf3");
  });
});
