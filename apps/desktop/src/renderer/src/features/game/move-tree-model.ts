import { statusForFen } from "@chaturanga/shared/chess/position";
import type { MoveNode } from "@chaturanga/shared/types/chess";

const DEFAULT_ROOT_ID = "root";

export type TreeVariationRow = {
  node: MoveNode;
  depth: number;
  branchStart: boolean;
};

export type TreeVariationBlock = {
  rows: TreeVariationRow[];
};

type TreeMainlineRow = {
  number: number;
  white?: MoveNode;
  black?: MoveNode;
};

type TreeModel = {
  mainline: TreeMainlineRow[];
  rootVariations: TreeVariationBlock[];
  variationsByParent: Map<string, TreeVariationBlock[]>;
};

function nodeColor(node: MoveNode): "white" | "black" {
  try {
    return statusForFen(node.fenBefore).turn;
  } catch {
    return node.ply % 2 === 1 ? "white" : "black";
  }
}

/** The FEN's fullmove number, so a game from a set-up position (a puzzle at move 30) counts from there. */
function moveNumber(node: MoveNode): number {
  const fullmove = Number(node.fenBefore.split(" ")[5]);
  return Number.isInteger(fullmove) && fullmove > 0 ? fullmove : Math.floor(Math.max(0, node.ply - 1) / 2) + 1;
}

function movePrefix(node: MoveNode): string {
  const number = moveNumber(node);
  return nodeColor(node) === "black" ? `${number}…` : `${number}.`;
}

function buildVariationBlock(
  startId: string,
  nodeMap: ReadonlyMap<string, MoveNode>,
  initialDepth: number
): TreeVariationBlock {
  const rows: TreeVariationRow[] = [];
  const stack: Array<{ id: string; depth: number }> = [{ id: startId, depth: initialDepth }];
  const seen = new Set<string>();

  while (stack.length) {
    const next = stack.pop();
    if (!next || seen.has(next.id)) continue;
    const node = nodeMap.get(next.id);
    if (!node) continue;
    seen.add(next.id);
    rows.push({ node, depth: next.depth, branchStart: rows.length === 0 });

    // Process the continuation first, then sibling variations, without recursion.
    for (let index = node.children.length - 1; index >= 1; index -= 1) {
      const childId = node.children[index];
      if (childId) stack.push({ id: childId, depth: next.depth + 1 });
    }
    const continuation = node.children[0];
    if (continuation) stack.push({ id: continuation, depth: next.depth });
  }

  return { rows };
}

/**
 * Flattens the game tree into a stable display model. The first child remains
 * the canonical mainline; later children are variations at the point where
 * they diverge. Variation traversal is iterative so unusually deep analysis
 * lines do not overflow the React call stack.
 */
export function buildTreeModel(nodes: readonly MoveNode[], rootId = DEFAULT_ROOT_ID): TreeModel {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const root = nodeMap.get(rootId) ?? nodes.find((node) => node.parentId === null);
  if (!root) {
    return { mainline: [], rootVariations: [], variationsByParent: new Map() };
  }

  const mainlineNodes: MoveNode[] = [];
  const mainlineSeen = new Set<string>();
  let cursor: MoveNode | undefined = root;
  while (cursor) {
    const childId = cursor.children[0];
    if (!childId || mainlineSeen.has(childId)) break;
    const child = nodeMap.get(childId);
    if (!child) break;
    mainlineSeen.add(child.id);
    mainlineNodes.push(child);
    cursor = child;
  }

  const mainline: TreeMainlineRow[] = [];
  for (let index = 0; index < mainlineNodes.length; index += 2) {
    const first = mainlineNodes[index];
    const second = mainlineNodes[index + 1];
    const cells = [first, second].filter((node): node is MoveNode => Boolean(node));
    const white = cells.find((node) => nodeColor(node) === "white");
    const black = cells.find((node) => nodeColor(node) === "black");
    mainline.push({
      number: moveNumber(first),
      white: white ?? (first && nodeColor(first) === "white" ? first : undefined),
      black: black ?? (second && nodeColor(second) === "black" ? second : undefined)
    });
  }

  const variationsByParent = new Map<string, TreeVariationBlock[]>();
  for (const node of nodes) {
    const variationIds = node.children.slice(1);
    if (!variationIds.length) continue;
    variationsByParent.set(
      node.id,
      variationIds.map((id) => buildVariationBlock(id, nodeMap, 0))
    );
  }

  return {
    mainline,
    rootVariations: variationsByParent.get(root.id) ?? [],
    variationsByParent
  };
}

export { movePrefix };
