import { addMoveNode } from "@chaturanga/shared/chess/pgn";
import { fenAfterUci } from "@chaturanga/shared/chess/position";
import type { BroadcastMove } from "@chaturanga/shared/types/broadcast";
import type { MoveNode } from "@chaturanga/shared/types/chess";

/**
 * A followed broadcast game on the analysis board: its live moves are the main line, and whatever
 * the user plays is kept beside it as variations. These pure helpers keep that true as moves
 * arrive and when the user goes back to live.
 */

const ROOT_ID = "root";

/** A tree with the live moves merged in, and the ids of the live line's nodes (root first). */
export type MergedLiveLine = { moveTree: MoveNode[]; liveIds: string[] };

/**
 * Merges the game's live moves into `moveTree`: each live move reuses the node already there (a
 * move the user guessed right included) or is added, and becomes its parent's first child, so the
 * live line is always the main line and the user's own moves stay as variations. Clocks follow
 * the live ones. Null when a live move can't be played on the tree (a different game).
 */
export function mergeLiveLine(
  moveTree: readonly MoveNode[],
  moves: readonly BroadcastMove[]
): MergedLiveLine | null {
  let tree = [...moveTree];
  let parent = tree.find((node) => node.id === ROOT_ID);
  if (!parent) return null;
  const liveIds = [parent.id];
  for (const move of moves) {
    const fenAfter = fenAfterUci(parent.fenAfter, move.uci);
    if (!fenAfter) return null;
    const added = addMoveNode(tree, parent.id, {
      san: move.san,
      uci: move.uci,
      fenBefore: parent.fenAfter,
      fenAfter
    });
    tree = added.moveTree;
    const nodeId = added.node.id;
    const parentId = parent.id;
    tree = tree.map((node) => {
      if (node.id === parentId && node.children[0] !== nodeId)
        return { ...node, children: [nodeId, ...node.children.filter((id) => id !== nodeId)] };
      if (node.id === nodeId && (node.clockAfter ?? null) !== move.clock)
        return { ...node, clockAfter: move.clock };
      return node;
    });
    const next = tree.find((node) => node.id === nodeId);
    if (!next) return null;
    parent = next;
    liveIds.push(next.id);
  }
  return { moveTree: tree, liveIds };
}

/** The moves the user added: every node off the live line. */
export function ownMoveCount(moveTree: readonly MoveNode[], liveIds: readonly string[]): number {
  const live = new Set(liveIds);
  return moveTree.filter((node) => !live.has(node.id)).length;
}

/** The tree with only the live line left, and the nodes taken out (to put back on undo). */
export function pruneToLiveLine(
  moveTree: readonly MoveNode[],
  liveIds: readonly string[]
): { moveTree: MoveNode[]; removed: MoveNode[] } {
  const live = new Set(liveIds);
  const kept: MoveNode[] = [];
  const removed: MoveNode[] = [];
  for (const node of moveTree) {
    if (!live.has(node.id)) {
      removed.push(node);
      continue;
    }
    const children = node.children.filter((id) => live.has(id));
    kept.push(children.length === node.children.length ? node : { ...node, children });
  }
  return { moveTree: kept, removed };
}

/**
 * Puts nodes `pruneToLiveLine` took out back into `moveTree` (live moves may have arrived since):
 * each subtree goes back under its parent, after the children it has now. A subtree whose parent
 * is gone (the live line was corrected meanwhile) is dropped.
 */
export function restoreRemovedMoves(
  moveTree: readonly MoveNode[],
  removed: readonly MoveNode[]
): MoveNode[] {
  const present = new Set(moveTree.map((node) => node.id));
  const removedIds = new Set(removed.map((node) => node.id));
  // Each removed subtree's top node hangs off a node still in the tree.
  const roots = removed.filter(
    (node) => node.parentId !== null && !removedIds.has(node.parentId) && present.has(node.parentId)
  );
  const restored = new Set<string>();
  const queue = roots.map((node) => node.id);
  while (queue.length) {
    const id = queue.shift();
    if (id === undefined || restored.has(id)) continue;
    restored.add(id);
    for (const node of removed) if (node.parentId === id) queue.push(node.id);
  }
  const newChildren = new Map<string, string[]>();
  for (const node of roots) {
    if (node.parentId === null) continue;
    newChildren.set(node.parentId, [...(newChildren.get(node.parentId) ?? []), node.id]);
  }
  return [
    ...moveTree.map((node) => {
      const extra = newChildren.get(node.id)?.filter((id) => !node.children.includes(id));
      return extra?.length ? { ...node, children: [...node.children, ...extra] } : node;
    }),
    ...removed.filter((node) => restored.has(node.id))
  ];
}
