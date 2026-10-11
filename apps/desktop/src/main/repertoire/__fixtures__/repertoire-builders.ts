/** Repertoire test material: chapter trees from UCI lines, and service calls built on them. */
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type {
  RepertoireChapter,
  RepertoireColor,
  RepertoireDetail,
  RepertoireNodeMeta
} from "@chaturanga/shared/types/repertoire";
import { fenAfterUci, START_FEN } from "@chaturanga/shared/chess/position";
import type * as RepertoireService from "../service";

/** A chapter tree built from UCI lines (shared prefixes become one path). */
export function treeOf(rootFen: string, lines: string[][]): MoveNode[] {
  const root: MoveNode = {
    id: "root",
    parentId: null,
    san: null,
    uci: null,
    fenBefore: rootFen,
    fenAfter: rootFen,
    ply: 0,
    nags: [],
    comment: null,
    arrows: [],
    highlights: [],
    children: []
  };
  const tree = [root];
  let next = 1;
  for (const line of lines) {
    let parent = root;
    for (const uci of line) {
      let child = parent.children
        .map((id) => tree.find((node) => node.id === id)!)
        .find((node) => node.uci === uci);
      if (!child) {
        const fen = fenAfterUci(parent.fenAfter, uci);
        if (!fen) throw new Error(`illegal ${uci}`);
        child = {
          id: `n${next++}`,
          parentId: parent.id,
          san: uci,
          uci,
          fenBefore: parent.fenAfter,
          fenAfter: fen,
          ply: parent.ply + 1,
          nags: [],
          comment: null,
          arrows: [],
          highlights: [],
          children: []
        };
        parent.children.push(child.id);
        tree.push(child);
      }
      parent = child;
    }
  }
  return tree;
}

/** The id of the node reached by `line` in `tree`. */
export function nodeAt(tree: MoveNode[], line: string[]): MoveNode {
  let node = tree.find((item) => item.id === "root")!;
  for (const uci of line) {
    node = node.children
      .map((id) => tree.find((item) => item.id === id)!)
      .find((item) => item.uci === uci)!;
  }
  return node;
}

type SaveOptions = {
  chapterId?: string;
  kind?: "opening" | "reference";
  meta?: (tree: MoveNode[]) => Record<string, RepertoireNodeMeta>;
  rootFen?: string;
  enabled?: boolean;
  /** Authored comments, by the UCI line of the node they belong to (joined with spaces). */
  comments?: Record<string, string>;
};

/** A tree from `lines` with the authored comments of `comments` on their nodes. */
function commentedTree(
  rootFen: string,
  lines: string[][],
  comments: Record<string, string> = {}
): MoveNode[] {
  const tree = treeOf(rootFen, lines);
  for (const [line, comment] of Object.entries(comments)) {
    nodeAt(tree, line ? line.split(" ") : []).comment = comment;
  }
  return tree;
}

/** The chapter a save sends: the existing one (or the one named) with a tree of `lines`. */
function chapterOf(
  detail: RepertoireDetail,
  lines: string[][],
  options: SaveOptions
): RepertoireChapter {
  const existing = detail.chapters.find(
    (chapter) => chapter.id === (options.chapterId ?? detail.chapters[0]?.id)
  );
  const rootFen = options.rootFen ?? existing?.rootFen ?? START_FEN;
  const tree = commentedTree(rootFen, lines, options.comments);
  return {
    id: options.chapterId ?? existing!.id,
    title: "Chapter",
    sortOrder: existing?.sortOrder ?? detail.chapters.length,
    kind: options.kind ?? "opening",
    enabled: options.enabled ?? true,
    rootFen,
    revision: existing?.revision ?? 0,
    nodeCount: 0,
    dueCount: 0,
    headers: {},
    tree,
    nodeMeta: options.meta?.(tree) ?? {}
  };
}

/** Service calls the tests share, on the test file's own (mocked) service module. */
export function serviceHelpers(service: typeof RepertoireService) {
  let attemptCounter = 0;
  return {
    create: (color: RepertoireColor = "white", rootFen?: string) =>
      service.createRepertoire({ name: `My ${color} repertoire`, color, rootFen }),
    save: (repertoireId: string, lines: string[][], options: SaveOptions = {}) => {
      const detail = service.getRepertoire(repertoireId);
      const chapter = chapterOf(detail, lines, options);
      return service.saveChapter({ repertoireId, chapter, expectedRevision: detail.revision });
    },
    learnFirst: (repertoireId: string) => {
      const session = service.startPractice({ repertoireId, mode: "learn-new" });
      return { session, card: session.cards[0] };
    },
    attempt: (
      sessionId: string,
      queueItemId: string,
      uci: string,
      attemptId = `a${++attemptCounter}`
    ) => service.recordAttempt({ sessionId, queueItemId, uci, attemptId })
  };
}
