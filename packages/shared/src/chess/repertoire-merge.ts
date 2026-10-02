/**
 * Merging copied material into an existing chapter (design §10): nodes match by the chapter root's
 * position identity and then by UCI path, never by SAN text. Pure.
 */
import type { MoveNode } from "../types/chess";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type RepertoireChapter,
  type RepertoireNodeMeta
} from "../types/repertoire";
import { fenAfterUci } from "./position";
import { positionKey } from "./repertoire-position";

export type MergeIncoming = {
  rootFen: string;
  /** Root id `"root"`; moves in the stored UCI form (castling as `e1g1`). */
  tree: readonly MoveNode[];
  /** Metadata of the incoming tree, keyed by incoming id. */
  nodeMeta: Record<string, RepertoireNodeMeta>;
  /**
   * Incoming ids whose edge may upgrade a matched existing `reference` edge (the confirmed policy).
   * Omitted = every incoming node.
   */
  upgradeNodeIds?: readonly string[];
};

export type MergeResult = {
  chapter: RepertoireChapter;
  /** Incoming moves appended as new nodes. */
  added: number;
  /** Incoming moves the chapter already had (kept, not duplicated). */
  alreadyPresent: number;
  /** Incoming node id → chapter node id (new or matched). */
  idMap: Record<string, string>;
};

/** The next free `n<k>` id generator for a chapter (k beyond its largest numeric `n` id). */
function idGenerator(existing: readonly MoveNode[]): () => string {
  const taken = new Set(existing.map((node) => node.id));
  let next = 1;
  for (const node of existing) {
    const match = /^n(\d+)$/.exec(node.id);
    if (match) next = Math.max(next, Number(match[1]) + 1);
  }
  return () => {
    while (taken.has(`n${next}`)) next += 1;
    const id = `n${next++}`;
    taken.add(id);
    return id;
  };
}

/**
 * Merges `incoming` into `existing` without changing what the chapter already says:
 * - the roots must be the same position (move counters may differ), else this throws;
 * - an incoming move the chapter already has at the same UCI path is matched, keeping the
 *   existing node, its comment and annotations; an empty existing comment, NAG list, arrow list or
 *   highlight list takes the incoming one;
 * - other incoming moves are appended as new branches (after the existing children) with fresh
 *   chapter-local ids, and take the incoming metadata (`reference` when there is none; a
 *   `trainingStart` only when the chapter already marks a start, so existing routes keep training);
 * - a matched existing `reference` edge becomes the incoming `included`/`covered` edge when the
 *   node is in `upgradeNodeIds`; an edge is never downgraded.
 * Merging the same material twice adds nothing the second time.
 */
export function mergeIntoChapter(
  existing: RepertoireChapter,
  incoming: MergeIncoming
): MergeResult {
  if (positionKey(existing.rootFen) !== positionKey(incoming.rootFen)) {
    throw new Error(
      "Invalid destination: the selected material starts at a different position than the chapter"
    );
  }
  const incomingById = new Map(incoming.tree.map((node) => [node.id, node]));
  const incomingRoot = incomingById.get(REPERTOIRE_ROOT_NODE_ID);
  if (!incomingRoot)
    throw new Error(`Invalid material: node "${REPERTOIRE_ROOT_NODE_ID}" is missing`);

  const tree = existing.tree.map((node) => ({
    ...node,
    nags: [...node.nags],
    arrows: [...node.arrows],
    highlights: [...node.highlights],
    children: [...node.children]
  }));
  const byId = new Map(tree.map((node) => [node.id, node]));
  const root = byId.get(REPERTOIRE_ROOT_NODE_ID);
  if (!root) throw new Error(`Invalid chapter: node "${REPERTOIRE_ROOT_NODE_ID}" is missing`);

  const nodeMeta: Record<string, RepertoireNodeMeta> = Object.create(null);
  for (const [id, meta] of Object.entries(existing.nodeMeta)) nodeMeta[id] = { ...meta };
  const chapterHasStart = Object.values(existing.nodeMeta).some((meta) => meta.trainingStart);
  const upgrades = incoming.upgradeNodeIds ? new Set(incoming.upgradeNodeIds) : null;
  const nextId = idGenerator(tree);
  const idMap: Record<string, string> = Object.create(null);
  let added = 0;
  let alreadyPresent = 0;

  const fillEmpty = (target: MoveNode, source: MoveNode) => {
    if (!target.comment?.trim() && source.comment?.trim()) target.comment = source.comment;
    if (!target.nags.length && source.nags.length) target.nags = [...source.nags];
    if (!target.arrows.length && source.arrows.length) {
      target.arrows = source.arrows.map((arrow) => ({ ...arrow }));
    }
    if (!target.highlights.length && source.highlights.length) {
      target.highlights = source.highlights.map((highlight) => ({ ...highlight }));
    }
  };

  idMap[incomingRoot.id] = root.id;
  fillEmpty(root, incomingRoot);

  // Pre-order over the incoming tree, so new ids follow authored order.
  const stack: { child: MoveNode; target: MoveNode }[] = [];
  const visited = new Set<string>([incomingRoot.id]);
  const pushChildren = (source: MoveNode, target: MoveNode) => {
    for (let i = source.children.length - 1; i >= 0; i--) {
      const child = incomingById.get(source.children[i]);
      if (child?.uci && !visited.has(child.id)) stack.push({ child, target });
    }
  };
  pushChildren(incomingRoot, root);
  for (let item = stack.pop(); item; item = stack.pop()) {
    const { child, target } = item;
    if (visited.has(child.id)) continue;
    visited.add(child.id);
    const uci = child.uci!;
    const match = target.children.map((id) => byId.get(id)).find((node) => node?.uci === uci);
    if (match) {
      alreadyPresent += 1;
      idMap[child.id] = match.id;
      fillEmpty(match, child);
      const incomingMeta = incoming.nodeMeta[child.id];
      const current = nodeMeta[match.id] ?? { edge: "included" as const };
      if (
        current.edge === "reference" &&
        incomingMeta &&
        incomingMeta.edge !== "reference" &&
        (!upgrades || upgrades.has(child.id))
      ) {
        nodeMeta[match.id] = { ...current, edge: incomingMeta.edge };
      }
      pushChildren(child, match);
      continue;
    }
    const node: MoveNode = {
      id: nextId(),
      parentId: target.id,
      san: child.san,
      uci,
      fenBefore: target.fenAfter,
      fenAfter: fenAfterUci(target.fenAfter, uci) ?? child.fenAfter,
      ply: target.ply + 1,
      nags: [...child.nags],
      comment: child.comment,
      clockAfter: null,
      arrows: child.arrows.map((arrow) => ({ ...arrow })),
      highlights: child.highlights.map((highlight) => ({ ...highlight })),
      children: []
    };
    target.children.push(node.id);
    tree.push(node);
    byId.set(node.id, node);
    idMap[child.id] = node.id;
    added += 1;
    // A new move without incoming metadata is study material, never a silent acceptance.
    const meta: RepertoireNodeMeta = { ...(incoming.nodeMeta[child.id] ?? { edge: "reference" }) };
    if (meta.trainingStart && !chapterHasStart) delete meta.trainingStart;
    nodeMeta[node.id] = meta;
    pushChildren(child, node);
  }

  return {
    chapter: { ...existing, tree, nodeMeta, nodeCount: tree.length - 1 },
    added,
    alreadyPresent,
    idMap
  };
}
