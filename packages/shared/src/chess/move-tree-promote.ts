import type { MoveNode } from "../types/chess";

/*
 * Promoting a variation in a move tree, whose first child at each move is the main line. Pure: each
 * returns a new tree (the nodes it changes are copies) and keeps every node's id, so a selected
 * move stays selected.
 */

/** Moves `nodeId` to the front of its parent's children (it becomes the main line there). */
export function promoteChild(tree: readonly MoveNode[], nodeId: string): MoveNode[] {
  const node = tree.find((item) => item.id === nodeId);
  if (!node?.parentId) return [...tree];
  return tree.map((item) =>
    item.id === node.parentId && item.children[0] !== nodeId
      ? { ...item, children: [nodeId, ...item.children.filter((id) => id !== nodeId)] }
      : item
  );
}

/**
 * The move a one-step promotion moves for `nodeId`: the node itself or its nearest ancestor that
 * isn't its parent's first child. Null on the main line (or for the root).
 */
export function promotionTarget(tree: readonly MoveNode[], nodeId: string): string | null {
  const byId = new Map(tree.map((node) => [node.id, node]));
  let node = byId.get(nodeId);
  while (node?.parentId) {
    const parent = byId.get(node.parentId);
    if (parent && parent.children[0] !== node.id) return node.id;
    node = parent;
  }
  return null;
}

/**
 * Makes the path from the start to `nodeId` the main line: at every point where it leaves the main
 * line (however deeply nested), its move becomes the first child, and the line it replaced becomes
 * the first variation there. Null when `nodeId` is on the main line already (or unknown).
 */
export function promoteToMainline(tree: readonly MoveNode[], nodeId: string): MoveNode[] | null {
  let next: MoveNode[] | null = null;
  for (;;) {
    const target = promotionTarget(next ?? tree, nodeId);
    if (!target) return next;
    next = promoteChild(next ?? tree, target);
  }
}
