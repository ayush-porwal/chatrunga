import type { MoveNode } from "@chaturanga/shared/types/chess";

/** The moves from the root to `nodeId`, in UCI. Walks an id index (runs before every engine search). */
export function currentLineUcis(moveTree: MoveNode[], nodeId: string): string[] {
  const byId = new Map(moveTree.map((item) => [item.id, item]));
  const reversed: string[] = [];
  let node = byId.get(nodeId);
  while (node && node.parentId) {
    if (node.uci) reversed.push(node.uci);
    node = byId.get(node.parentId);
  }
  return reversed.reverse();
}
