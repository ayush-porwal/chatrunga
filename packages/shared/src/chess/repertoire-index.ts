/**
 * Derived repertoire index (design §7.1, §7.3): which chapter occurrences are in training scope,
 * and the repertoire-wide decisions they support. Pure and disposable — rebuilt from a validated
 * chapter revision, never persisted as a second source of the moves.
 */
import type { MoveNode } from "../types/chess";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type RepertoireChapter,
  type RepertoireColor,
  type RepertoireDecision,
  type RepertoireEdgeKind,
  type RepertoireNodeMeta
} from "../types/repertoire";
import { playerToMove, positionKey } from "./repertoire-position";

/** The chapter fields the index reads. */
export type RepertoireChapterContent = Pick<
  RepertoireChapter,
  "id" | "kind" | "enabled" | "sortOrder" | "tree" | "nodeMeta"
>;

export type ChapterLookup = {
  nodesById: Map<string, MoveNode>;
  /** Child ids in authored order (only children that exist in the tree). */
  childrenById: Map<string, string[]>;
  /** Node ids from the root to the node, both included. */
  parentPath: Map<string, string[]>;
  /** Position key of each node's position (`fenAfter`; the root's is the chapter root). */
  positionKeys: Map<string, string>;
  /** Node ids reachable from the root, parents before children (authored order). */
  order: string[];
};

/**
 * Indexes a chapter tree once. Walks from the root iteratively and visits each node id once, so a
 * malformed tree (a cycle, a node listed twice) can't recurse forever; unreachable nodes are left
 * out.
 */
export function buildChapterLookup(chapter: Pick<RepertoireChapter, "tree">): ChapterLookup {
  const nodesById = new Map(chapter.tree.map((node) => [node.id, node]));
  const childrenById = new Map<string, string[]>();
  const parentPath = new Map<string, string[]>();
  const positionKeys = new Map<string, string>();
  const order: string[] = [];

  const root = nodesById.get(REPERTOIRE_ROOT_NODE_ID);
  if (!root) throw new Error("Chapter tree has no root node");

  const stack: { id: string; path: string[] }[] = [{ id: root.id, path: [root.id] }];
  while (stack.length) {
    const { id, path } = stack.pop()!;
    if (parentPath.has(id)) continue;
    const node = nodesById.get(id)!;
    parentPath.set(id, path);
    positionKeys.set(id, positionKey(node.fenAfter));
    order.push(id);
    const children = node.children.filter(
      (childId) => nodesById.has(childId) && !parentPath.has(childId)
    );
    childrenById.set(id, children);
    // Reverse so the first child is visited first (pre-order, authored order).
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ id: children[i], path: [...path, children[i]] });
    }
  }
  return { nodesById, childrenById, parentPath, positionKeys, order };
}

export type ScopeState = "active" | "before-start" | "after-stop" | "disabled" | "reference";

/** Metadata of a node, with defaults for nodes that have none (an `included` edge). */
export function nodeMetaOf(
  nodeMeta: Record<string, RepertoireNodeMeta>,
  nodeId: string
): RepertoireNodeMeta {
  return nodeMeta[nodeId] ?? { edge: "included" };
}

/**
 * Training scope of every reachable node (§7.1). A node's state describes its position and the
 * edge leading into it:
 * - a disabled chapter or a disabled node/ancestor → `disabled`;
 * - a reference chapter, or a `reference` edge on the node or an ancestor → `reference`;
 * - below a node marked `trainingStop` → `after-stop` (the stop node itself stays active);
 * - before a `trainingStart` node on its route (when the chapter marks any) → `before-start`;
 * - otherwise `active`.
 */
export function computeScopeStates(
  chapter: Pick<RepertoireChapter, "kind" | "enabled" | "tree" | "nodeMeta">,
  lookup: ChapterLookup = buildChapterLookup(chapter)
): Map<string, ScopeState> {
  const states = new Map<string, ScopeState>();
  const hasStart = Object.values(chapter.nodeMeta).some((meta) => meta.trainingStart);

  for (const id of lookup.order) {
    const node = lookup.nodesById.get(id)!;
    if (!chapter.enabled) {
      states.set(id, "disabled");
      continue;
    }
    if (chapter.kind === "reference") {
      states.set(id, "reference");
      continue;
    }
    const meta = nodeMetaOf(chapter.nodeMeta, id);
    const isRoot = id === REPERTOIRE_ROOT_NODE_ID;
    const parentState = node.parentId ? states.get(node.parentId) : undefined;
    const parentMeta = node.parentId ? nodeMetaOf(chapter.nodeMeta, node.parentId) : undefined;

    let state: ScopeState;
    if (meta.disabled || parentState === "disabled") state = "disabled";
    else if ((!isRoot && meta.edge === "reference") || parentState === "reference") {
      state = "reference";
    } else if (parentState === "after-stop" || parentMeta?.trainingStop) state = "after-stop";
    else if (meta.trainingStart) state = "active";
    else if (isRoot) state = hasStart ? "before-start" : "active";
    else state = parentState === "active" ? "active" : "before-start";
    states.set(id, state);
  }
  return states;
}

export type DecisionOccurrence = {
  chapterId: string;
  nodeId: string;
  ply: number;
  chapterOrder: number;
};

export type CollectedDecision = {
  positionKey: string;
  /** Full FEN of the first occurrence (for rendering; the key is the identity). */
  fen: string;
  /** Supported choices in authored order (chapter order, then branch order). */
  acceptedUcis: Set<string>;
  occurrences: DecisionOccurrence[];
};

/**
 * One entry per unique position key where the repertoire's player is to move and at least one
 * active, included own-side continuation exists (in an enabled opening chapter). Both the parent
 * position and the child edge must be `active`, so a `trainingStart` node's position is the first
 * card of its route and a `trainingStop` node's position is not a card. Each tree node is visited
 * once: repeated positions add finite occurrences and never unfold transpositions.
 */
export function collectDecisions(
  color: RepertoireColor,
  chapters: readonly RepertoireChapterContent[]
): Map<string, CollectedDecision> {
  const decisions = new Map<string, CollectedDecision>();
  const ordered = [...chapters].sort((a, b) => a.sortOrder - b.sortOrder);

  ordered.forEach((chapter, chapterOrder) => {
    if (!chapter.enabled || chapter.kind !== "opening") return;
    const lookup = buildChapterLookup(chapter);
    const states = computeScopeStates(chapter, lookup);

    for (const id of lookup.order) {
      if (states.get(id) !== "active") continue;
      const node = lookup.nodesById.get(id)!;
      if (playerToMove(node.fenAfter) !== color) continue;

      const ucis: string[] = [];
      for (const childId of lookup.childrenById.get(id) ?? []) {
        const child = lookup.nodesById.get(childId)!;
        if (!child.uci || states.get(childId) !== "active") continue;
        if (nodeMetaOf(chapter.nodeMeta, childId).edge !== "included") continue;
        ucis.push(child.uci);
      }
      if (!ucis.length) continue;

      const key = lookup.positionKeys.get(id)!;
      let decision = decisions.get(key);
      if (!decision) {
        decision = {
          positionKey: key,
          fen: node.fenAfter,
          acceptedUcis: new Set(),
          occurrences: []
        };
        decisions.set(key, decision);
      }
      for (const uci of ucis) decision.acceptedUcis.add(uci);
      decision.occurrences.push({ chapterId: chapter.id, nodeId: id, ply: node.ply, chapterOrder });
    }
  });
  return decisions;
}

/** The stored choices that currently have a supporting occurrence, in stored order. */
export function effectiveAcceptedUcis(
  decision: Pick<RepertoireDecision, "acceptedUcis">,
  supported: ReadonlySet<string>
): string[] {
  return decision.acceptedUcis.filter((uci) => supported.has(uci));
}

/**
 * The choice hints should point at: the stored preference while it is supported, otherwise the
 * first supported accepted choice (without overwriting the stored preference, §7.1).
 */
export function effectivePreferredUci(
  decision: Pick<RepertoireDecision, "acceptedUcis" | "preferredUci">,
  supported: ReadonlySet<string>
): string | null {
  if (decision.preferredUci && supported.has(decision.preferredUci)) return decision.preferredUci;
  return effectiveAcceptedUcis(decision, supported)[0] ?? null;
}

/** Order-independent identity of an accepted set (sorted, deduplicated, `,`-joined). */
export function acceptanceFingerprint(acceptedUcis: readonly string[]): string {
  return [...new Set(acceptedUcis)].sort().join(",");
}

export type DecisionReconciliation = {
  /** Decisions to insert or update (new positions, or stored ones that gained choices). */
  upserts: RepertoireDecision[];
  /** Stored decisions with no supporting occurrence any more: suspend their progress. */
  suspendedKeys: string[];
};

/**
 * Brings stored decisions in line with the collected index:
 * - a new position gets the collected choices, preferring the first authored one;
 * - a stored decision keeps its choices (inactive ones too, so re-enabling restores them) and
 *   gains newly included ones; its preference is kept, and only filled in when it has none;
 * - a stored decision nothing supports any more is reported in `suspendedKeys` (never deleted).
 */
export function reconcileDecisions(
  existing: readonly RepertoireDecision[],
  collected: ReadonlyMap<string, CollectedDecision>,
  { repertoireId }: { repertoireId: string }
): DecisionReconciliation {
  const upserts: RepertoireDecision[] = [];
  const suspendedKeys: string[] = [];
  const stored = new Map(existing.map((decision) => [decision.positionKey, decision]));

  for (const [key, entry] of collected) {
    const supported = [...entry.acceptedUcis];
    const previous = stored.get(key);
    if (!previous) {
      upserts.push({
        repertoireId,
        positionKey: key,
        acceptedUcis: supported,
        preferredUci: supported[0] ?? null,
        prompt: null,
        hint: null,
        wrongMoveFeedback: {},
        paused: false
      });
      continue;
    }
    const added = supported.filter((uci) => !previous.acceptedUcis.includes(uci));
    const preferredUci = previous.preferredUci ?? supported[0] ?? null;
    if (added.length || preferredUci !== previous.preferredUci) {
      upserts.push({
        ...previous,
        acceptedUcis: [...previous.acceptedUcis, ...added],
        preferredUci
      });
    }
  }
  for (const key of stored.keys()) {
    if (!collected.has(key)) suspendedKeys.push(key);
  }
  return { upserts, suspendedKeys };
}

/**
 * Import default (§10 step 4): along the main route the first own-side continuation is
 * `included` and other own-side alternatives are `reference` (until the user selects them);
 * opponent moves are `covered`. Returns metadata for every non-root node.
 */
export function defaultImportNodeMeta(
  color: RepertoireColor,
  tree: MoveNode[]
): Record<string, RepertoireNodeMeta> {
  const lookup = buildChapterLookup({ tree });
  const meta: Record<string, RepertoireNodeMeta> = {};
  for (const id of lookup.order) {
    const node = lookup.nodesById.get(id)!;
    const ownMove = playerToMove(node.fenAfter) === color;
    (lookup.childrenById.get(id) ?? []).forEach((childId, index) => {
      const edge: RepertoireEdgeKind = !ownMove
        ? "covered"
        : index === 0
          ? "included"
          : "reference";
      meta[childId] = { edge };
    });
  }
  return meta;
}
