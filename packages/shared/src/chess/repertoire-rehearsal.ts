/**
 * Line rehearsal (design §5.3, §7.3): which authored lines a chapter offers from a start node, and
 * which opponent reply to supply next. Pure: the main process keeps the session state (replies
 * already seen, lines already finished) and asks these helpers to plan the route.
 *
 * A line is the authored route from the start node to an endpoint, through active nodes only: at
 * the player's turn it follows `included` moves, at the opponent's turn any active reply. It ends
 * at a node marked "stop branch here" (`stop`), at a node with no such continuation (`leaf`), or
 * where the next move would exceed the depth limit (`depth`, counted in plies from the chapter
 * root like the other practice modes). Because a route through a tree is unique, a line is
 * identified by its end node. Index links to other chapters are never followed, so a repeated
 * position is just another finite occurrence.
 */
import type { MoveNode } from "../types/chess";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type RepertoireChapter,
  type RepertoireColor
} from "../types/repertoire";
import {
  buildChapterLookup,
  computeScopeStates,
  nodeMetaOf,
  type ChapterLookup,
  type ScopeState
} from "./repertoire-index";
import { playerToMove } from "./repertoire-position";

/** Default depth limit of a rehearsal, in plies from the chapter root. */
export const DEFAULT_REHEARSAL_DEPTH_PLIES = 60;

export type RehearsalEndReason = "stop" | "leaf" | "depth";

/** One chapter prepared for rehearsal. */
export type RehearsalContext = {
  lookup: ChapterLookup;
  states: Map<string, ScopeState>;
  nodeMeta: RepertoireChapter["nodeMeta"];
  color: RepertoireColor;
  rootPly: number;
  maxDepthPlies: number;
};

export type RehearsalLine = {
  /** Stable id of the line (derived from its end node). */
  lineId: string;
  endNodeId: string;
  endReason: RehearsalEndReason;
  /** Node ids from the start node to the end node, both included. */
  nodeIds: string[];
  /** The positions on the line where the player is tested (player to move, not the end). */
  decisionNodeIds: string[];
};

/** Indexes a chapter for rehearsal with the given depth limit. */
export function rehearsalContext(
  chapter: Pick<RepertoireChapter, "kind" | "enabled" | "tree" | "nodeMeta">,
  color: RepertoireColor,
  maxDepthPlies: number = DEFAULT_REHEARSAL_DEPTH_PLIES,
  lookup: ChapterLookup = buildChapterLookup(chapter)
): RehearsalContext {
  return {
    lookup,
    states: computeScopeStates(chapter, lookup),
    nodeMeta: chapter.nodeMeta,
    color,
    rootPly: lookup.nodesById.get(REPERTOIRE_ROOT_NODE_ID)?.ply ?? 0,
    maxDepthPlies
  };
}

/** The line id of the route ending at `endNodeId`. */
export function lineIdOf(endNodeId: string): string {
  return `line-${endNodeId}`;
}

/** The player is to move at this node's position. */
export function isPlayerNode(context: RehearsalContext, nodeId: string): boolean {
  const node = context.lookup.nodesById.get(nodeId);
  return node !== undefined && playerToMove(node.fenAfter) === context.color;
}

/**
 * The moves a line may continue with from a node, in authored order, or why the line ends there.
 * Only an active node continues; the player's continuations are its active `included` children
 * and the opponent's are its active children.
 */
export function continuations(
  context: RehearsalContext,
  nodeId: string
): { children: string[]; end: RehearsalEndReason | null } {
  const { lookup, states, nodeMeta } = context;
  if (states.get(nodeId) !== "active") return { children: [], end: "leaf" };
  if (nodeMetaOf(nodeMeta, nodeId).trainingStop) return { children: [], end: "stop" };
  const player = isPlayerNode(context, nodeId);
  const eligible = (lookup.childrenById.get(nodeId) ?? []).filter((childId) => {
    const child = lookup.nodesById.get(childId)!;
    if (!child.uci || states.get(childId) !== "active") return false;
    return !player || nodeMetaOf(nodeMeta, childId).edge === "included";
  });
  if (!eligible.length) return { children: [], end: "leaf" };
  const children = eligible.filter(
    (childId) => lookup.nodesById.get(childId)!.ply - context.rootPly <= context.maxDepthPlies
  );
  if (!children.length) return { children: [], end: "depth" };
  return { children, end: null };
}

/**
 * Every line from `startNodeId`, depth first in authored order. Lines on which the player never
 * moves are left out (there is nothing to rehearse on them).
 */
export function enumerateLines(context: RehearsalContext, startNodeId: string): RehearsalLine[] {
  const lines: RehearsalLine[] = [];
  if (!context.lookup.nodesById.has(startNodeId)) return lines;
  const stack: string[][] = [[startNodeId]];
  while (stack.length) {
    const route = stack.pop()!;
    const last = route[route.length - 1];
    const { children, end } = continuations(context, last);
    if (end) {
      const decisionNodeIds = route.slice(0, -1).filter((id) => isPlayerNode(context, id));
      if (decisionNodeIds.length) {
        lines.push({
          lineId: lineIdOf(last),
          endNodeId: last,
          endReason: end,
          nodeIds: route,
          decisionNodeIds
        });
      }
      continue;
    }
    // Reverse so the first authored child is explored first.
    for (let i = children.length - 1; i >= 0; i--) stack.push([...route, children[i]]);
  }
  return lines;
}

export type RoutePlan = {
  endNodeId: string;
  endReason: RehearsalEndReason;
  /** Node ids from the start node to the end node, both included. */
  nodeIds: string[];
};

/**
 * Plans the line to play from `startNodeId`. Branches that still lead to a pending line (an end
 * node in `pending`) come first. At the player's turn the first such move in authored order is
 * taken; at the opponent's turn replies rotate deterministically: fewest times seen this session
 * (`seen`, keyed by reply node id) first, then authored order. With nothing pending below, the
 * same rotation picks among all continuations.
 */
export function planRoute(
  context: RehearsalContext,
  startNodeId: string,
  pending: ReadonlySet<string>,
  seen: Readonly<Record<string, number>>
): RoutePlan {
  const memo = new Map<string, boolean>();
  const leadsToPending = (nodeId: string): boolean => {
    const cached = memo.get(nodeId);
    if (cached !== undefined) return cached;
    // Iterative post-order so deep chapters can't overflow the stack.
    const stack: { id: string; expanded: boolean }[] = [{ id: nodeId, expanded: false }];
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (memo.has(top.id)) {
        stack.pop();
        continue;
      }
      const { children } = continuations(context, top.id);
      if (!top.expanded) {
        top.expanded = true;
        for (const child of children) {
          if (!memo.has(child)) stack.push({ id: child, expanded: false });
        }
        continue;
      }
      stack.pop();
      memo.set(top.id, pending.has(top.id) || children.some((child) => memo.get(child) === true));
    }
    return memo.get(nodeId) === true;
  };

  const nodeIds = [startNodeId];
  let current = startNodeId;
  for (;;) {
    const { children, end } = continuations(context, current);
    if (end) return { endNodeId: current, endReason: end, nodeIds };
    let next: string;
    if (isPlayerNode(context, current)) {
      next = children.find(leadsToPending) ?? children[0];
    } else {
      next = children
        .map((id, index) => ({ id, index, pending: leadsToPending(id) ? 0 : 1 }))
        .sort(
          (a, b) =>
            a.pending - b.pending || (seen[a.id] ?? 0) - (seen[b.id] ?? 0) || a.index - b.index
        )[0].id;
    }
    nodeIds.push(next);
    current = next;
  }
}

/** The child of `nodeId` on the route to `endNodeId`, or null when it isn't on that route. */
export function nextOnRoute(
  lookup: ChapterLookup,
  nodeId: string,
  endNodeId: string
): MoveNode | null {
  const path = lookup.parentPath.get(endNodeId);
  if (!path) return null;
  const index = path.indexOf(nodeId);
  if (index < 0 || index === path.length - 1) return null;
  return lookup.nodesById.get(path[index + 1]) ?? null;
}
