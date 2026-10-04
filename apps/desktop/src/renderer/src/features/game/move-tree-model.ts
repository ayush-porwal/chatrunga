import { statusForFen } from "@chaturanga/shared/chess/position";
import type { MoveNode } from "@chaturanga/shared/types/chess";

const DEFAULT_ROOT_ID = "root";

/** One move of a variation's row, with the number written before it (`9.`, `9…` or none). */
export type VariationMove = { node: MoveNode; number: string | null };

/**
 * A variation drawn as one line row: its moves inline (`9. a4 h6 10. e4`), from the move that
 * leaves its parent line to the end of its own first-child chain. `depth` 0 branches off the main
 * line; a variation that branches off a variation is one deeper.
 */
export type VariationRow = {
  /** The line's first move: a stable key for the row. */
  id: string;
  depth: number;
  moves: VariationMove[];
};

type TreeMainlineRow = {
  number: number;
  white?: MoveNode;
  black?: MoveNode;
};

export type TreeModel = {
  mainline: TreeMainlineRow[];
  /**
   * The variation rows drawn under a main-line move's pair, by that move's id: the lines played
   * instead of it, each followed by the rows nested in it (pre-order, depth first).
   */
  variationsByMove: Map<string, VariationRow[]>;
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
  return Number.isInteger(fullmove) && fullmove > 0
    ? fullmove
    : Math.floor(Math.max(0, node.ply - 1) / 2) + 1;
}

/**
 * The number before the `index`-th move of a line: `9.` before White's moves, `9…` before Black's
 * when it opens the line, none before Black's others, and none for a row that isn't a move (Study's
 * "… N more moves" placeholder has no SAN).
 */
export function variationMoveNumber(node: MoveNode, index: number): string | null {
  if (!node.san) return null;
  if (nodeColor(node) === "white") return `${moveNumber(node)}.`;
  return index === 0 ? `${moveNumber(node)}…` : null;
}

/** The line as it reads on screen: `9. a4 h6 10. e4` (moves without SAN are left out). */
export function variationText(moves: readonly VariationMove[]): string {
  return moves
    .filter((move) => move.node.san)
    .map((move) => (move.number ? `${move.number} ${move.node.san}` : move.node.san))
    .join(" ");
}

/**
 * The rows of the lines starting at `startIds` (alternatives at one point, in order), each followed
 * by the rows that branch off it along the way, one level deeper. Iterative, so unusually deep or
 * long analysis lines do not overflow the call stack.
 */
function variationRows(
  startIds: readonly string[],
  nodeMap: ReadonlyMap<string, MoveNode>,
  seen: Set<string>
): VariationRow[] {
  const rows: VariationRow[] = [];
  const stack = startIds.map((id) => ({ id, depth: 0 })).reverse();
  while (stack.length) {
    const start = stack.pop()!;
    const moves: VariationMove[] = [];
    const nested: Array<{ id: string; depth: number }> = [];
    let id: string | undefined = start.id;
    while (id && !seen.has(id)) {
      const node = nodeMap.get(id);
      if (!node) break;
      seen.add(id);
      moves.push({ node, number: variationMoveNumber(node, moves.length) });
      for (const alternative of node.children.slice(1))
        nested.push({ id: alternative, depth: start.depth + 1 });
      id = node.children[0];
    }
    if (moves.length) rows.push({ id: start.id, depth: start.depth, moves });
    // Pre-order: this row's nested rows come next, in the order they branch along it.
    for (let index = nested.length - 1; index >= 0; index -= 1) stack.push(nested[index]!);
  }
  return rows;
}

/**
 * Flattens the game tree into a stable display model. The first child remains the canonical main
 * line, paired two moves to a row; every other child starts a variation, drawn as a line row under
 * the pair of the main-line move it was played instead of, with the variations inside it nested
 * under it.
 */
export function buildTreeModel(nodes: readonly MoveNode[], rootId = DEFAULT_ROOT_ID): TreeModel {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const root = nodeMap.get(rootId) ?? nodes.find((node) => node.parentId === null);
  if (!root) return { mainline: [], variationsByMove: new Map() };

  const mainlineNodes: MoveNode[] = [];
  const seen = new Set<string>([root.id]);
  let cursor: MoveNode = root;
  for (;;) {
    const childId = cursor.children[0];
    if (!childId || seen.has(childId)) break;
    const child = nodeMap.get(childId);
    if (!child) break;
    seen.add(child.id);
    mainlineNodes.push(child);
    cursor = child;
  }

  // The moves played instead of each main-line move: its parent's other children.
  const variationsByMove = new Map<string, VariationRow[]>();
  let parent = root;
  for (const node of mainlineNodes) {
    const alternatives = parent.children.slice(1);
    if (alternatives.length)
      variationsByMove.set(node.id, variationRows(alternatives, nodeMap, seen));
    parent = node;
  }

  // One row per move number: a White move starts a row, Black's reply fills it. A line that starts
  // with Black (a position set up with Black to move) opens with a row that has no White move.
  const mainline: TreeMainlineRow[] = [];
  for (const node of mainlineNodes) {
    const row = mainline[mainline.length - 1];
    if (nodeColor(node) === "white") mainline.push({ number: moveNumber(node), white: node });
    else if (row && !row.black && row.number === moveNumber(node)) row.black = node;
    else mainline.push({ number: moveNumber(node), black: node });
  }

  return { mainline, variationsByMove };
}
