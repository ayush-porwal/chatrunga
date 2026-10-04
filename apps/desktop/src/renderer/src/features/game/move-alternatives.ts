import { openBestLine, type BestLineCursor, type BestLineStep } from "./best-line-cursor";

/*
 * ↑ / ↓ in the move list: switching between the alternatives to the current move, Lichess-like.
 * At a branch point the alternatives are, in the list's order: the game's move there (the main
 * line's, or the parent line's), its BEST line when it is a marked error with one, then the
 * variations played instead of it. Switching keeps the depth into the line: it lands on the target
 * line's move at the same ply (its last move when it is shorter).
 */

type TreeNode = { id: string; parentId?: string | null; children: readonly string[] };

/** Where the board is: a move of the tree, or a move of a BEST line being browsed. */
export type MovePosition =
  | { kind: "node"; nodeId: string }
  | { kind: "best"; cursor: BestLineCursor };

/** One alternative at a branch point: a line of the tree from its first move, or a BEST line. */
export type Alternative =
  | { kind: "line"; startId: string }
  | { kind: "best"; markedNodeId: string; anchorNodeId: string; moves: readonly BestLineStep[] };

/** The alternatives at a branch point, which one the board is on, and how deep into it. */
export type AlternativeGroup = { alternatives: Alternative[]; current: number; depth: number };

/**
 * The branch point the current move belongs to and its alternatives. A main-line move, or the first
 * move of a variation or BEST line, has the alternatives at its own ply; a move further into a
 * variation or BEST line has those where that line starts (the innermost, for nested lines).
 * `bestLineOf` gives a move's BEST line (empty: it has none).
 */
export function alternativeGroup(
  tree: readonly TreeNode[],
  position: MovePosition,
  bestLineOf: (nodeId: string) => readonly BestLineStep[]
): AlternativeGroup | null {
  const byId = new Map(tree.map((node) => [node.id, node]));
  let start: TreeNode | undefined;
  let depth = 0;
  if (position.kind === "best") {
    // A BEST line is played instead of its marked move.
    start = byId.get(position.cursor.markedNodeId);
    depth = position.cursor.index;
  } else {
    start = byId.get(position.nodeId);
    // Up the line to its first move: a move that isn't its parent's first child. None (the main
    // line): the move's own ply.
    let node = start;
    let steps = 0;
    while (node?.parentId) {
      const parent = byId.get(node.parentId);
      if (!parent) break;
      if (parent.children[0] !== node.id) {
        start = node;
        depth = steps;
        break;
      }
      node = parent;
      steps += 1;
    }
  }
  const branch = start?.parentId ? byId.get(start.parentId) : undefined;
  const gameMove = branch?.children[0];
  if (!branch || !gameMove || !start) return null;

  const alternatives: Alternative[] = [{ kind: "line", startId: gameMove }];
  const best = bestLineOf(gameMove);
  if (best.length)
    alternatives.push({
      kind: "best",
      markedNodeId: gameMove,
      anchorNodeId: branch.id,
      moves: best
    });
  for (const id of branch.children.slice(1)) alternatives.push({ kind: "line", startId: id });

  const current =
    position.kind === "best"
      ? alternatives.findIndex((item) => item.kind === "best")
      : alternatives.findIndex((item) => item.kind === "line" && item.startId === start.id);
  if (current < 0) return null;
  return { alternatives, current, depth };
}

/**
 * Where ↓ (`delta` 1) or ↑ (-1) takes the board: the next or previous alternative, wrapping around,
 * at the same depth into it. Null when the current move has no alternatives.
 */
export function alternativeTarget(
  tree: readonly TreeNode[],
  position: MovePosition,
  bestLineOf: (nodeId: string) => readonly BestLineStep[],
  delta: 1 | -1
): MovePosition | null {
  const group = alternativeGroup(tree, position, bestLineOf);
  if (!group || group.alternatives.length < 2) return null;
  const count = group.alternatives.length;
  const target = group.alternatives[(group.current + delta + count) % count]!;
  if (target.kind === "best") {
    const cursor = openBestLine(
      target.markedNodeId,
      target.anchorNodeId,
      target.moves,
      group.depth
    );
    return cursor ? { kind: "best", cursor } : null;
  }
  // Down the target line's first children, stopping at its end.
  const byId = new Map(tree.map((node) => [node.id, node]));
  let nodeId = target.startId;
  for (let step = 0; step < group.depth; step += 1) {
    const next = byId.get(nodeId)?.children[0];
    if (!next || !byId.has(next)) break;
    nodeId = next;
  }
  return { kind: "node", nodeId };
}
