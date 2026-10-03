/**
 * Why a chapter trains what it does (design §7.1): the cause that keeps a position out of
 * practice, what keeps a whole chapter from training anything, and the one-step change that makes
 * a chapter train like a freshly imported one. Pure; the study and practice screens explain their
 * empty states with it.
 */
import {
  REPERTOIRE_ROOT_NODE_ID,
  type RepertoireChapter,
  type RepertoireColor,
  type RepertoireNodeMeta
} from "../types/repertoire";
import {
  buildChapterLookup,
  collectDecisions,
  nodeMetaOf,
  type ChapterLookup
} from "./repertoire-index";
import { playerToMove } from "./repertoire-position";

/**
 * What keeps a position (or a whole chapter) out of practice:
 * - `left-out`: the chapter is switched off for practice;
 * - `reference-chapter`: the chapter is reference material;
 * - `reference-move`: the move at `nodeId` (on the route, or the move itself) is reference only;
 * - `disabled-branch`: the branch from `nodeId` is left out of practice;
 * - `stopped`: practice ends at `nodeId`, before this position;
 * - `before-start`: practice starts at `nodeId`, on another route or later on this one.
 */
export type ScopeCause =
  | { kind: "left-out" }
  | { kind: "reference-chapter" }
  | { kind: "reference-move"; nodeId: string }
  | { kind: "disabled-branch"; nodeId: string }
  | { kind: "stopped"; nodeId: string }
  | { kind: "before-start"; nodeId: string };

/** A chapter with nothing to practise: a scope cause, or a tree that offers no move of the player. */
export type TrainingBlocker = ScopeCause | { kind: "no-moves" } | { kind: "no-own-moves" };

export type ChapterTraining = {
  /** Position keys of the unique decisions the chapter supports on its own. */
  decisionKeys: string[];
  /** Why it supports none (null when it supports some). */
  blocker: TrainingBlocker | null;
};

type TrainingChapter = Pick<
  RepertoireChapter,
  "id" | "kind" | "enabled" | "sortOrder" | "tree" | "nodeMeta"
>;

/**
 * Why `nodeId`'s position is out of training scope, or null when it is in scope. Mirrors
 * computeScopeStates: the chapter first, then the route from the root (a left-out branch, a
 * reference move, a practice end above the node), then a practice start the route never passes.
 */
export function scopeCause(
  chapter: Pick<RepertoireChapter, "kind" | "enabled" | "nodeMeta">,
  lookup: ChapterLookup,
  nodeId: string
): ScopeCause | null {
  if (!chapter.enabled) return { kind: "left-out" };
  if (chapter.kind === "reference") return { kind: "reference-chapter" };
  const path = lookup.parentPath.get(nodeId);
  if (!path) return null;
  for (const id of path) {
    const meta = nodeMetaOf(chapter.nodeMeta, id);
    if (meta.disabled) return { kind: "disabled-branch", nodeId: id };
    if (id !== REPERTOIRE_ROOT_NODE_ID && meta.edge === "reference") {
      return { kind: "reference-move", nodeId: id };
    }
    if (id !== nodeId && meta.trainingStop) return { kind: "stopped", nodeId: id };
  }
  const start = firstStart(chapter, lookup);
  if (start && !path.some((id) => nodeMetaOf(chapter.nodeMeta, id).trainingStart)) {
    return { kind: "before-start", nodeId: start };
  }
  return null;
}

/** The first node, in authored order, marked "start training here" (null when none is). */
function firstStart(
  chapter: Pick<RepertoireChapter, "nodeMeta">,
  lookup: ChapterLookup
): string | null {
  return lookup.order.find((id) => nodeMetaOf(chapter.nodeMeta, id).trainingStart) ?? null;
}

/**
 * Why the player's move into `nodeId` isn't asked in practice, or null when it is (or the move is
 * an opponent's). Its position must be in scope and the move itself an accepted one in scope.
 */
export function ownMoveCause(
  chapter: Pick<RepertoireChapter, "kind" | "enabled" | "nodeMeta">,
  lookup: ChapterLookup,
  nodeId: string
): ScopeCause | null {
  const node = lookup.nodesById.get(nodeId);
  if (!node?.parentId) return null;
  return (
    scopeCause(chapter, lookup, node.parentId) ??
    scopeCause(chapter, lookup, nodeId) ??
    (nodeMetaOf(chapter.nodeMeta, nodeId).edge === "included"
      ? null
      : { kind: "reference-move", nodeId })
  );
}

/**
 * How many decisions the chapter supports on its own and, when none, what is in the way: the
 * chapter itself, an empty tree, a tree without a move of the player, or the cause that keeps the
 * player's first move (in authored order) out of practice.
 */
export function chapterTraining(
  color: RepertoireColor,
  chapter: TrainingChapter,
  lookup: ChapterLookup = buildChapterLookup(chapter)
): ChapterTraining {
  const decisionKeys = [...collectDecisions(color, [chapter]).keys()];
  const none = (blocker: TrainingBlocker): ChapterTraining => ({ decisionKeys, blocker });
  if (decisionKeys.length) return { decisionKeys, blocker: null };
  if (!chapter.enabled) return none({ kind: "left-out" });
  if (chapter.kind === "reference") return none({ kind: "reference-chapter" });
  if (lookup.order.length <= 1) return none({ kind: "no-moves" });
  for (const id of lookup.order) {
    const node = lookup.nodesById.get(id)!;
    if (!node.parentId || !node.uci) continue;
    if (playerToMove(lookup.nodesById.get(node.parentId)!.fenAfter) !== color) continue;
    const cause = ownMoveCause(chapter, lookup, id);
    if (cause) return none(cause);
  }
  return none({ kind: "no-own-moves" });
}

/**
 * The chapter as it trains after "Practise this chapter": switched on, an opening chapter, and
 * the import default (§10 step 4) filled in along every route that trains — at a position of the
 * player with no accepted move the first authored one is accepted, and opponent replies marked
 * reference are covered. Moves below a reference alternative of the player stay as they are, and
 * training marks (start, end, left-out branches) are kept.
 */
export function trainableChapter<
  T extends Pick<RepertoireChapter, "kind" | "enabled" | "tree" | "nodeMeta">
>(color: RepertoireColor, chapter: T): T {
  const lookup = buildChapterLookup(chapter);
  const nodeMeta: Record<string, RepertoireNodeMeta> = { ...chapter.nodeMeta };
  const setEdge = (id: string, edge: RepertoireNodeMeta["edge"]) => {
    nodeMeta[id] = { ...nodeMetaOf(nodeMeta, id), edge };
  };
  const pending = [REPERTOIRE_ROOT_NODE_ID];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    const children = lookup.childrenById.get(id) ?? [];
    if (!children.length) continue;
    if (playerToMove(lookup.nodesById.get(id)!.fenAfter) === color) {
      if (!children.some((child) => nodeMetaOf(nodeMeta, child).edge === "included")) {
        setEdge(children[0], "included");
      }
      pending.push(...children.filter((child) => nodeMetaOf(nodeMeta, child).edge === "included"));
    } else {
      for (const child of children) {
        if (nodeMetaOf(nodeMeta, child).edge === "reference") setEdge(child, "covered");
      }
      pending.push(...children);
    }
  }
  return { ...chapter, kind: "opening", enabled: true, nodeMeta };
}
