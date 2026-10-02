import { applyUserMove, START_FEN } from "@chaturanga/shared/chess/position";
import type { MoveNode, Square } from "@chaturanga/shared/types/chess";
import type {
  PracticeCard,
  RepertoireChapter,
  RepertoireDetail,
  RepertoireNodeMeta
} from "@chaturanga/shared/types/repertoire";

/** Test helpers: chapters built from UCI lines, with readable node ids. */

export function rootNode(fen = START_FEN): MoveNode {
  return {
    id: "root",
    parentId: null,
    san: null,
    uci: null,
    fenBefore: fen,
    fenAfter: fen,
    ply: 0,
    nags: [],
    comment: null,
    arrows: [],
    highlights: [],
    children: []
  };
}

/**
 * Adds `ucis` as a line under `parentId`, naming nodes `${prefix}${index}`. Returns the tree and
 * the new ids in order.
 */
export function addLine(
  tree: MoveNode[],
  parentId: string,
  ucis: string[],
  prefix: string
): { tree: MoveNode[]; ids: string[] } {
  let nodes = tree.map((node) => ({ ...node, children: [...node.children] }));
  const ids: string[] = [];
  let parent = nodes.find((node) => node.id === parentId)!;
  ucis.forEach((uci, index) => {
    const moved = applyUserMove(parent.fenAfter, {
      from: uci.slice(0, 2) as Square,
      to: uci.slice(2, 4) as Square
    })!;
    const node: MoveNode = {
      ...rootNode(),
      id: `${prefix}${index}`,
      parentId: parent.id,
      san: moved.san,
      uci: moved.uci,
      fenBefore: parent.fenAfter,
      fenAfter: moved.fen,
      ply: parent.ply + 1
    };
    const parentId = parent.id;
    nodes = nodes.map((item) =>
      item.id === parentId ? { ...item, children: [...item.children, node.id] } : item
    );
    nodes.push(node);
    ids.push(node.id);
    parent = node;
  });
  return { tree: nodes, ids };
}

export function chapterOf(
  tree: MoveNode[],
  nodeMeta: Record<string, RepertoireNodeMeta> = {},
  overrides: Partial<RepertoireChapter> = {}
): RepertoireChapter {
  return {
    id: "c1",
    title: "Italian",
    sortOrder: 0,
    kind: "opening",
    enabled: true,
    rootFen: START_FEN,
    revision: 1,
    nodeCount: tree.length - 1,
    dueCount: 0,
    headers: {},
    tree,
    nodeMeta,
    ...overrides
  };
}

export function detailOf(overrides: Partial<RepertoireDetail> = {}): RepertoireDetail {
  return {
    id: "r1",
    name: "My 1.e4 repertoire",
    color: "white",
    description: "",
    tags: [],
    revision: 4,
    archivedAt: null,
    createdAt: 0,
    updatedAt: 0,
    chapterCount: 1,
    decisionCount: 0,
    dueCount: 0,
    lastStudiedAt: null,
    chapters: [],
    workspace: null,
    ...overrides
  };
}

export function cardOf(id: string, overrides: Partial<PracticeCard> = {}): PracticeCard {
  return {
    queueItemId: id,
    positionKey: `key-${id}`,
    fen: START_FEN,
    orientation: "white",
    leadUp: [],
    chapterId: "c1",
    nodeId: "root",
    prompt: null,
    stage: "review",
    state: "unanswered",
    hintStage: 0,
    attemptsSoFar: 0,
    ...overrides
  };
}
