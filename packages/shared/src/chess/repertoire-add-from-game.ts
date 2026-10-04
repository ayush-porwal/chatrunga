/**
 * Add to repertoire from a game (design §6.2): which part of a game's tree is copied, and the
 * choice policy proposed for it. Pure. The caller validates the source tree first (legal moves,
 * root id `"root"`, normalised castling); these functions only reshape it.
 *
 * Two id spaces meet here: SOURCE ids (the game's nodes, which the dialog and its policy name) and
 * the copied tree's chapter-local ids (`root`, `n1`, `n2`, … in pre-order).
 */
import type { MoveNode } from "../types/chess";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type AddFromGameScope,
  type ChapterKind,
  type RepertoireChapter,
  type RepertoireColor,
  type RepertoireNodeMeta
} from "../types/repertoire";
import { rootPly } from "./pgn";
import {
  buildChapterLookup,
  computeScopeStates,
  defaultImportNodeMeta,
  nodeMetaOf
} from "./repertoire-index";
import { formatPath } from "./repertoire-pgn";
import { playerToMove, positionKey } from "./repertoire-position";
import { nullPrototypeRecord } from "../types/record";

/** The material a scope selects, as a chapter-shaped tree with chapter-local ids. */
export type ExtractedScope = {
  rootFen: string;
  /** Root id `"root"`, other nodes `n1…` in pre-order; plies counted from `rootFen`. */
  tree: MoveNode[];
  /** Source node id → copied node id (the source root, or the re-rooted node, maps to `"root"`). */
  sourceToChapterIds: Record<string, string>;
  /** Copied node id → source node id. */
  chapterToSourceIds: Record<string, string>;
  /**
   * Source ids of the moves leading to the selected node when a subtree keeps the game's root
   * (the selected node's own move included). They are study context, never part of the policy.
   */
  contextNodeIds: string[];
  /** Copied id of the node training starts at (a subtree that keeps the game's root), else null. */
  startNodeId: string | null;
};

export type AddFromGamePolicy = { includedNodeIds: string[]; coveredNodeIds: string[] };

export type OwnMoveCandidate = {
  nodeId: string;
  san: string;
  uci: string;
  ply: number;
  path: string;
};

type SourceIndex = { byId: Map<string, MoveNode>; root: MoveNode };

function indexSource(tree: readonly MoveNode[]): SourceIndex {
  const byId = new Map(tree.map((node) => [node.id, node]));
  const root = byId.get(REPERTOIRE_ROOT_NODE_ID);
  if (!root) throw new Error(`Invalid source tree: node "${REPERTOIRE_ROOT_NODE_ID}" is missing`);
  return { byId, root };
}

function requireNode(index: SourceIndex, id: string): MoveNode {
  const node = index.byId.get(id);
  if (!node) throw new Error(`Invalid scope: node "${id}" is not in the game`);
  return node;
}

/** Source nodes from the root to `node`, both included. */
function pathTo(index: SourceIndex, node: MoveNode): MoveNode[] {
  const path: MoveNode[] = [];
  const seen = new Set<string>();
  for (let current: MoveNode | undefined = node; current; ) {
    if (seen.has(current.id)) throw new Error(`Invalid source tree: node "${current.id}" loops`);
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId === null ? undefined : index.byId.get(current.parentId);
  }
  if (path[0].id !== REPERTOIRE_ROOT_NODE_ID) {
    throw new Error(`Invalid source tree: node "${node.id}" is not connected to the root`);
  }
  return path;
}

/** A copy of a source node's content under new ids (the game clock is not copied). */
function copyNode(source: MoveNode, id: string, parentId: string | null, ply: number): MoveNode {
  return {
    id,
    parentId,
    san: source.san,
    uci: source.uci,
    fenBefore: source.fenBefore,
    fenAfter: source.fenAfter,
    ply,
    nags: [...source.nags],
    comment: source.comment,
    clockAfter: null,
    arrows: source.arrows.map((arrow) => ({ ...arrow })),
    highlights: source.highlights.map((highlight) => ({ ...highlight })),
    children: []
  };
}

/**
 * Builds the copied tree. `prefix` is a source path from the copied root (exclusive) whose last
 * node owns `subtreeOf`'s children; with no prefix, `subtreeOf` itself is the copied root. When
 * `subtree` is false only the prefix is copied.
 */
function build(
  index: SourceIndex,
  rootSource: MoveNode,
  rootFen: string,
  prefix: readonly MoveNode[],
  subtree: boolean
): Omit<ExtractedScope, "contextNodeIds" | "startNodeId"> {
  const tree: MoveNode[] = [];
  const sourceToChapterIds: Record<string, string> = nullPrototypeRecord();
  const chapterToSourceIds: Record<string, string> = nullPrototypeRecord();
  let next = 1;

  const root = copyNode(rootSource, REPERTOIRE_ROOT_NODE_ID, null, rootPly(rootFen));
  root.san = null;
  root.uci = null;
  root.nags = [];
  root.fenBefore = rootFen;
  root.fenAfter = rootFen;
  tree.push(root);
  sourceToChapterIds[rootSource.id] = root.id;
  chapterToSourceIds[root.id] = rootSource.id;

  const add = (source: MoveNode, parent: MoveNode): MoveNode => {
    const node = copyNode(source, `n${next++}`, parent.id, parent.ply + 1);
    parent.children.push(node.id);
    tree.push(node);
    sourceToChapterIds[source.id] = node.id;
    chapterToSourceIds[node.id] = source.id;
    return node;
  };

  let parent = root;
  for (const source of prefix) parent = add(source, parent);

  if (subtree) {
    // Pre-order, authored child order; each source node is copied once.
    const stack: { source: MoveNode; parent: MoveNode }[] = [];
    const lastSource = prefix.length ? prefix[prefix.length - 1] : rootSource;
    const pushChildren = (source: MoveNode, copied: MoveNode) => {
      const children = source.children
        .map((id) => index.byId.get(id))
        .filter((child): child is MoveNode => Boolean(child));
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ source: children[i], parent: copied });
      }
    };
    pushChildren(lastSource, parent);
    for (let item = stack.pop(); item; item = stack.pop()) {
      if (item.source.id in sourceToChapterIds) continue;
      const copied = add(item.source, item.parent);
      pushChildren(item.source, copied);
    }
  }
  return { rootFen, tree, sourceToChapterIds, chapterToSourceIds };
}

/**
 * The material `scope` selects from a validated source game:
 * - `path`: the route from the game's root to `toNodeId`, without side variations;
 * - `subtree` / `original`: the moves leading to `fromNodeId` (reported as `contextNodeIds`, with
 *   training starting at the selected node) plus everything below it;
 * - `subtree` / `standalone`: a new root at the selected node's position with its subtree below,
 *   plies counted from that FEN (so a Black-to-move root numbers `12... Nf6`);
 * - `whole-game`: every node.
 * Comments, NAGs, arrows and highlights are kept; clocks are not. Throws on an unknown node id.
 */
export function extractScope(
  source: { rootFen: string; tree: readonly MoveNode[] },
  scope: AddFromGameScope
): ExtractedScope {
  const index = indexSource(source.tree);
  switch (scope.kind) {
    case "path": {
      const path = pathTo(index, requireNode(index, scope.toNodeId));
      return {
        ...build(index, index.root, source.rootFen, path.slice(1), false),
        contextNodeIds: [],
        startNodeId: null
      };
    }
    case "subtree": {
      const from = requireNode(index, scope.fromNodeId);
      if (scope.root === "standalone") {
        return {
          ...build(index, from, from.fenAfter, [], true),
          contextNodeIds: [],
          startNodeId: null
        };
      }
      const prefix = pathTo(index, from).slice(1);
      const extracted = build(index, index.root, source.rootFen, prefix, true);
      return {
        ...extracted,
        contextNodeIds: prefix.map((node) => node.id),
        startNodeId: prefix.length ? extracted.sourceToChapterIds[from.id] : null
      };
    }
    case "whole-game":
      return {
        ...build(index, index.root, source.rootFen, [], true),
        contextNodeIds: [],
        startNodeId: null
      };
    default:
      throw new Error("Invalid scope: expected path, subtree or whole-game");
  }
}

/**
 * The default choice policy in SOURCE ids (§6.2, §10 step 4). For an opening chapter and an
 * excerpt (not the whole game): along each prepared route the first own-side continuation is
 * included and opponent replies are covered; own-side alternatives, and everything below them,
 * stay reference. Context moves are never part of it. A reference chapter, or the whole game,
 * proposes nothing (all reference) until the user accepts moves.
 */
export function proposePolicy(
  color: RepertoireColor,
  extracted: ExtractedScope,
  scope: AddFromGameScope,
  chapterKind: ChapterKind
): AddFromGamePolicy {
  const policy: AddFromGamePolicy = { includedNodeIds: [], coveredNodeIds: [] };
  if (chapterKind !== "opening" || scope.kind === "whole-game") return policy;

  const defaults = defaultImportNodeMeta(color, extracted.tree);
  const byId = new Map(extracted.tree.map((node) => [node.id, node]));
  const startId = extracted.startNodeId ?? REPERTOIRE_ROOT_NODE_ID;
  // Walk from the start, keeping only nodes whose route there is included/covered throughout.
  const stack = [...(byId.get(startId)?.children ?? [])].reverse();
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    const edge = defaults[id]?.edge;
    if (edge !== "included" && edge !== "covered") continue;
    const sourceId = extracted.chapterToSourceIds[id];
    if (edge === "included") policy.includedNodeIds.push(sourceId);
    else policy.coveredNodeIds.push(sourceId);
    const children = byId.get(id)?.children ?? [];
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  return policy;
}

/**
 * Node metadata of the copied tree for a confirmed policy: included and covered source nodes keep
 * that edge, context moves become `covered` (a prepared route that never makes an accepted
 * choice), and every other move is `reference`. The start node is marked `trainingStart`, so the
 * context positions before it don't train. `sourceToChapterIds` maps source ids to the ids the
 * metadata is keyed by (the extracted tree's by default).
 */
export function applyPolicy(
  extracted: ExtractedScope,
  policy: AddFromGamePolicy,
  sourceToChapterIds: Record<string, string> = extracted.sourceToChapterIds
): Record<string, RepertoireNodeMeta> {
  const included = new Set(policy.includedNodeIds);
  const covered = new Set(policy.coveredNodeIds);
  const context = new Set(extracted.contextNodeIds);
  const meta: Record<string, RepertoireNodeMeta> = nullPrototypeRecord();
  for (const node of extracted.tree) {
    if (node.id === REPERTOIRE_ROOT_NODE_ID) continue;
    const sourceId = extracted.chapterToSourceIds[node.id];
    const target = sourceToChapterIds[sourceId];
    if (target === undefined) continue;
    const edge = included.has(sourceId)
      ? "included"
      : covered.has(sourceId) || context.has(sourceId)
        ? "covered"
        : "reference";
    meta[target] = { edge };
    if (node.id === extracted.startNodeId) meta[target].trainingStart = true;
  }
  return meta;
}

/**
 * The player's own moves in the copied material (context moves left out), in route order (pre-order),
 * for the dialog's checkboxes. `nodeId` is the source id; `path` is the SAN route from the copied
 * root, numbered from its FEN.
 */
export function listOwnMoves(
  color: RepertoireColor,
  extracted: ExtractedScope
): OwnMoveCandidate[] {
  return listMoves(extracted, (mover) => mover === color);
}

/**
 * The opponent's moves in the copied material (context moves left out), in route order, shaped
 * like `listOwnMoves`: the replies a "cover opponent replies" choice covers.
 */
export function listOpponentMoves(
  color: RepertoireColor,
  extracted: ExtractedScope
): OwnMoveCandidate[] {
  return listMoves(extracted, (mover) => mover !== color);
}

/**
 * The SAN route from the copied root to the first occurrence (pre-order) of a position key, or
 * null when the copied material never reaches it. An empty string is the root itself.
 */
export function pathToPosition(extracted: ExtractedScope, key: string): string | null {
  const byId = new Map(extracted.tree.map((node) => [node.id, node]));
  const root = byId.get(REPERTOIRE_ROOT_NODE_ID);
  if (!root) return null;
  const stack: { node: MoveNode; path: MoveNode[] }[] = [{ node: root, path: [] }];
  for (let item = stack.pop(); item; item = stack.pop()) {
    if (positionKey(item.node.fenAfter) === key) return formatPath(item.path);
    for (let i = item.node.children.length - 1; i >= 0; i--) {
      const child = byId.get(item.node.children[i]);
      if (child) stack.push({ node: child, path: [...item.path, child] });
    }
  }
  return null;
}

/** A move the user chose to accept, by its id in the stored chapter. */
export type ChosenMove = { chapterNodeId: string; san: string; path: string };

type UntrainedReason =
  | "reference"
  | "before-start"
  | "starts-line"
  | "after-stop"
  | "disabled"
  | "not-included";

const UNTRAINED_TEXT: Record<Exclude<UntrainedReason, "reference">, string> = {
  "before-start": "they come before the chapter's training start",
  "starts-line": "the chapter's training starts after them",
  "after-stop": "they come after a training stop",
  disabled: "they are in a disabled chapter or line",
  "not-included": "the chapter keeps them as reference"
};

/**
 * Which chosen moves an opening chapter (as it would be stored) will actually ask: a move trains
 * when its edge is `included` and both it and the position before it are in training scope
 * (§7.1). Returns how many train, and one warning per reason the others don't, such as "2 chosen
 * moves won't be trained: they come before the chapter's training start". Moves below an
 * unaccepted (reference) move are named with their path.
 */
export function untrainedMoveWarnings(
  chapter: Pick<RepertoireChapter, "kind" | "enabled" | "tree" | "nodeMeta">,
  moves: readonly ChosenMove[]
): { trained: number; warnings: string[] } {
  const lookup = buildChapterLookup(chapter);
  const states = computeScopeStates(chapter, lookup);
  const untrained = new Map<UntrainedReason, ChosenMove[]>();
  let trained = 0;
  for (const move of moves) {
    const node = lookup.nodesById.get(move.chapterNodeId);
    const state = states.get(move.chapterNodeId);
    if (!node || state === undefined) continue;
    const parentState = node.parentId === null ? undefined : states.get(node.parentId);
    let reason: UntrainedReason | null;
    if (state !== "active") reason = state;
    else if (parentState !== "active") reason = "starts-line";
    else if (nodeMetaOf(chapter.nodeMeta, node.id).edge !== "included") reason = "not-included";
    else reason = null;
    if (reason === null) trained += 1;
    else untrained.set(reason, [...(untrained.get(reason) ?? []), move]);
  }
  const warnings: string[] = [];
  for (const [reason, list] of untrained) {
    const count = `${list.length} chosen move${list.length === 1 ? "" : "s"} won't be trained`;
    if (reason !== "reference") {
      warnings.push(`${count}: ${UNTRAINED_TEXT[reason]}`);
      continue;
    }
    const named = list.slice(0, 3).map((move) => `${move.san} at ${move.path}`);
    const more = list.length > 3 ? ` and ${list.length - 3} more` : "";
    const verb = list.length === 1 ? "is" : "are";
    warnings.push(`${count}: ${named.join(", ")}${more} ${verb} below an unaccepted move`);
  }
  return { trained, warnings };
}

function listMoves(
  extracted: ExtractedScope,
  wanted: (mover: RepertoireColor) => boolean
): OwnMoveCandidate[] {
  const byId = new Map(extracted.tree.map((node) => [node.id, node]));
  const context = new Set(extracted.contextNodeIds);
  const moves: OwnMoveCandidate[] = [];
  const root = byId.get(REPERTOIRE_ROOT_NODE_ID);
  if (!root) return moves;
  const stack: { id: string; path: MoveNode[] }[] = [...root.children]
    .reverse()
    .map((id) => ({ id, path: [] }));
  for (let item = stack.pop(); item; item = stack.pop()) {
    const node = byId.get(item.id);
    if (!node) continue;
    const path = [...item.path, node];
    const sourceId = extracted.chapterToSourceIds[node.id];
    if (!context.has(sourceId) && node.uci && wanted(playerToMove(node.fenBefore))) {
      moves.push({
        nodeId: sourceId,
        san: node.san ?? node.uci,
        uci: node.uci,
        ply: node.ply,
        path: formatPath(path)
      });
    }
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push({ id: node.children[i], path });
    }
  }
  return moves;
}
