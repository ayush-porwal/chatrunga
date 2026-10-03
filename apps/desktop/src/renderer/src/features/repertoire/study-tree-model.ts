import type { ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { REPERTOIRE_ROOT_NODE_ID } from "@chaturanga/shared/types/repertoire";

/**
 * Collapsing long variation branches in the Study move tree (design §11). The tree view renders
 * one element per move, so a large chapter (thousands of moves) is cut down to the main line and
 * every side line up to a few plies below it; anything deeper becomes one "… N more moves" row
 * that expands on click. The selected node's path is always shown: selecting a hidden move (from
 * the board, the keyboard or a transposition link) expands the rows on its way, and those stay
 * expanded, so clicking around a visible tree never reshuffles it.
 */

/** Chapters with fewer moves than this render in full. */
export const COLLAPSE_MIN_MOVES = 400;
/** Plies of a side line shown below the main line or an expanded node. */
export const COLLAPSE_DEPTH = 6;

const PLACEHOLDER_PREFIX = "collapsed:";

export type CollapsedStudyTree = {
  /** The visible moves (parents of cut branches list a placeholder child instead). */
  nodes: MoveNode[];
  /** Placeholder node id → moves hidden behind it. */
  placeholders: Map<string, number>;
  /** Moves hidden in total. */
  hiddenMoves: number;
  /** Ids of the visible moves; null when nothing is collapsed. */
  visible: ReadonlySet<string> | null;
};

export type CollapseOptions = {
  /** Nodes whose branches show `depth` more plies (expanded rows and the selected path). */
  expanded: ReadonlySet<string>;
  depth?: number;
  minMoves?: number;
  /** Subtree sizes from `subtreeSizes` (computed when missing). */
  sizes?: ReadonlyMap<string, number>;
};

/** The id of the placeholder row standing for the cut branches of `parentId`. */
export function placeholderId(parentId: string): string {
  return `${PLACEHOLDER_PREFIX}${parentId}`;
}

/** The node a placeholder row belongs to, or null for a real move. */
export function placeholderParent(id: string): string | null {
  return id.startsWith(PLACEHOLDER_PREFIX) ? id.slice(PLACEHOLDER_PREFIX.length) : null;
}

/** Moves in each node's subtree, the node included (one pass, once per chapter revision). */
export function subtreeSizes(lookup: ChapterLookup): Map<string, number> {
  const sizes = new Map<string, number>();
  for (let index = lookup.order.length - 1; index >= 0; index--) {
    const id = lookup.order[index];
    let size = 1;
    for (const child of lookup.childrenById.get(id) ?? []) size += sizes.get(child) ?? 0;
    sizes.set(id, size);
  }
  return sizes;
}

/** True when `nodeId` is a move of the chapter that the collapsed tree doesn't show. */
export function isHidden(tree: CollapsedStudyTree, lookup: ChapterLookup, nodeId: string) {
  return Boolean(tree.visible && lookup.nodesById.has(nodeId) && !tree.visible.has(nodeId));
}

/** `expanded` plus every node on the path to `nodeId` (the node included), so it is shown. */
export function expandPathTo(
  expanded: ReadonlySet<string>,
  lookup: ChapterLookup,
  nodeId: string
): Set<string> {
  const next = new Set(expanded);
  for (const id of lookup.parentPath.get(nodeId) ?? []) next.add(id);
  return next;
}

/**
 * The visible part of a chapter tree. The main line is always shown; a side line shows `depth`
 * plies below the nearest main-line or expanded node, and the rest of each cut point becomes one
 * placeholder child at the place of its first hidden branch. Nodes that keep all their children
 * keep their identity, so memoised rows don't re-render. Small chapters are returned unchanged.
 */
export function collapseStudyTree(
  lookup: ChapterLookup,
  { expanded, depth = COLLAPSE_DEPTH, minMoves = COLLAPSE_MIN_MOVES, sizes }: CollapseOptions
): CollapsedStudyTree {
  const all = lookup.order.map((id) => lookup.nodesById.get(id)!);
  const uncollapsed: CollapsedStudyTree = {
    nodes: all,
    placeholders: new Map(),
    hiddenMoves: 0,
    visible: null
  };
  if (lookup.order.length - 1 < minMoves) return uncollapsed;
  const subtree = sizes ?? subtreeSizes(lookup);

  const mainline = new Set<string>();
  for (let id: string | undefined = REPERTOIRE_ROOT_NODE_ID; id; ) {
    mainline.add(id);
    id = lookup.childrenById.get(id)?.[0];
  }

  /** Plies below the nearest main-line or expanded node, for every visible node. */
  const distance = new Map<string, number>([[REPERTOIRE_ROOT_NODE_ID, 0]]);
  const replaced = new Map<string, MoveNode>();
  const placeholders = new Map<string, number>();
  const extra: MoveNode[] = [];
  let hiddenMoves = 0;

  for (const id of lookup.order) {
    const own = distance.get(id);
    if (own === undefined) continue; // Inside a cut branch.
    const node = lookup.nodesById.get(id)!;
    const resets = mainline.has(id) || expanded.has(id);
    const shown: string[] = [];
    let hidden = 0;
    let cutAt = -1;
    for (const child of lookup.childrenById.get(id) ?? []) {
      const childDistance = mainline.has(child) ? 0 : resets ? 1 : own + 1;
      if (childDistance <= depth) {
        distance.set(child, childDistance);
        shown.push(child);
      } else {
        if (cutAt < 0) cutAt = shown.length;
        hidden += subtree.get(child) ?? 1;
      }
    }
    if (!hidden) continue;
    const placeholder: MoveNode = {
      id: placeholderId(id),
      parentId: id,
      san: null,
      uci: null,
      fenBefore: node.fenAfter,
      fenAfter: node.fenAfter,
      ply: node.ply + 1,
      nags: [],
      comment: null,
      arrows: [],
      highlights: [],
      children: []
    };
    shown.splice(cutAt, 0, placeholder.id);
    replaced.set(id, { ...node, children: shown });
    placeholders.set(placeholder.id, hidden);
    extra.push(placeholder);
    hiddenMoves += hidden;
  }

  if (!hiddenMoves) return uncollapsed;
  const nodes = all
    .filter((node) => distance.has(node.id))
    .map((node) => replaced.get(node.id) ?? node);
  return {
    nodes: nodes.concat(extra),
    placeholders,
    hiddenMoves,
    visible: new Set(distance.keys())
  };
}
