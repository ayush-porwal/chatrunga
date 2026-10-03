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
import { nodeMetaOf } from "./repertoire-index";
import { positionKey } from "./repertoire-position";

export type MergeIncoming = {
  rootFen: string;
  /** Root id `"root"`; moves in the stored UCI form (castling as `e1g1`). */
  tree: readonly MoveNode[];
  /** Metadata of the incoming tree, keyed by incoming id. */
  nodeMeta: Record<string, RepertoireNodeMeta>;
  /**
   * Incoming ids whose edge may upgrade a matched existing edge (the confirmed policy and its
   * context). Omitted = every incoming node.
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
 * - when the chapter marks a training start, the first new node of a route that doesn't pass
 *   through an existing start is marked `trainingStart` when included moves follow it, so the new
 *   line trains instead of staying before the start; when that node is itself an included move,
 *   the start goes on the position it is played from instead, so the move trains, unless that
 *   would also start training other included moves the chapter keeps before its start;
 * - a matched existing `reference` edge becomes the incoming `included`/`covered` edge, and a
 *   matched `covered` edge becomes an incoming `included` one (the player's move, covered only as
 *   context before), when the node is in `upgradeNodeIds`; an edge is never downgraded. A move
 *   upgraded to `included` before the chapter's training start puts a start on the position it is
 *   played from, so it trains, under the same condition (otherwise the preview warns that it
 *   won't be trained).
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

  // Whether included moves follow an incoming node (itself included) on a route that no incoming
  // start below it already covers.
  const leadsToIncluded = (start: MoveNode): boolean => {
    const pending = [start];
    const seen = new Set<string>();
    for (let item = pending.pop(); item; item = pending.pop()) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      const meta = incoming.nodeMeta[item.id];
      if (item !== start && meta?.trainingStart) continue;
      if (meta?.edge === "included") return true;
      for (const id of item.children) {
        const child = incomingById.get(id);
        if (child?.uci) pending.push(child);
      }
    }
    return false;
  };

  // Whether a start on `position` would also start training an included move of the chapter
  // (other than `accepted`) that is before every start now: such moves stay as authored.
  const startsOtherMoves = (position: MoveNode, accepted: MoveNode): boolean => {
    const pending = [...position.children];
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
      const node = byId.get(id);
      if (!node || nodeMeta[id]?.trainingStart) continue;
      if (node !== accepted && nodeMetaOf(nodeMeta, id).edge === "included") return true;
      pending.push(...node.children);
    }
    return false;
  };

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
  // `fresh`: the target is a node this merge appended; `underStart`: the target's route passes
  // through an existing training start.
  type Item = { child: MoveNode; target: MoveNode; fresh: boolean; underStart: boolean };
  const stack: Item[] = [];
  const visited = new Set<string>([incomingRoot.id]);
  const pushChildren = (
    source: MoveNode,
    target: MoveNode,
    fresh: boolean,
    underStart: boolean
  ) => {
    for (let i = source.children.length - 1; i >= 0; i--) {
      const child = incomingById.get(source.children[i]);
      if (child?.uci && !visited.has(child.id)) stack.push({ child, target, fresh, underStart });
    }
  };
  pushChildren(incomingRoot, root, false, Boolean(nodeMeta[root.id]?.trainingStart));
  for (let item = stack.pop(); item; item = stack.pop()) {
    const { child, target, fresh, underStart } = item;
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
      const upgrade =
        incomingMeta !== undefined &&
        ((current.edge === "reference" && incomingMeta.edge !== "reference") ||
          (current.edge === "covered" && incomingMeta.edge === "included"));
      let below = underStart;
      if (upgrade && (!upgrades || upgrades.has(child.id))) {
        nodeMeta[match.id] = { ...current, edge: incomingMeta.edge };
        // A move accepted before the chapter's training start (covered context until now) trains
        // only when the position it is played from does: that position becomes a start too,
        // unless that would also start the chapter's other moves before its start.
        if (
          incomingMeta.edge === "included" &&
          chapterHasStart &&
          !underStart &&
          !startsOtherMoves(target, match)
        ) {
          nodeMeta[target.id] = { ...nodeMetaOf(nodeMeta, target.id), trainingStart: true };
          below = true;
        }
      }
      pushChildren(child, match, false, below || Boolean(nodeMeta[match.id]?.trainingStart));
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
    let below = underStart || Boolean(meta.trainingStart);
    if (chapterHasStart && !fresh && !underStart && leadsToIncluded(child)) {
      // An included first move trains only from a start on its position; else the start goes on
      // the move itself and only what follows it trains (the preview warns about the move).
      if (meta.edge === "included" && !startsOtherMoves(target, node)) {
        nodeMeta[target.id] = { ...nodeMetaOf(nodeMeta, target.id), trainingStart: true };
      } else meta.trainingStart = true;
      below = true;
    }
    pushChildren(child, node, true, below);
  }

  return {
    chapter: { ...existing, tree, nodeMeta, nodeCount: tree.length - 1 },
    added,
    alreadyPresent,
    idMap
  };
}
