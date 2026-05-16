import type { MoveNode } from "@chaturanga/shared/types/chess";

export function currentLineUcis(moveTree: MoveNode[], nodeId: string): string[] {
  const reversed: string[] = [];
  let node = moveTree.find((item) => item.id === nodeId);
  while (node && node.parentId) {
    if (node.uci) reversed.push(node.uci);
    node = moveTree.find((item) => item.id === node?.parentId);
  }
  return reversed.reverse();
}
