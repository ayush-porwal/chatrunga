import { nanoid } from "nanoid";
import { makeFen } from "chessops/fen";
import { makeSanAndPlay } from "chessops/san";
import { parseUci } from "chessops/util";
import { addMoveNode } from "@chaturanga/shared/chess/pgn";
import { positionFromFen } from "@chaturanga/shared/chess/position";
import { buildChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import { playerToMove, positionKey } from "@chaturanga/shared/chess/repertoire-position";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type RepertoireChapter,
  type RepertoireColor,
  type RepertoireNodeMeta
} from "@chaturanga/shared/types/repertoire";
import { moveKinds, sanOf } from "./repertoire-model";

/*
 * Staged moves (docs/repertoire-games-and-practice.md §3 "Staged moves"): moves played in Study
 * (on the board, from an engine line, the explorer or another screen) that the chapter doesn't
 * have yet. They hang beside the draft, under its nodes or under each other, and are never
 * autosaved nor undone; Add puts them in the chapter as one undoable edit. Pure, so it is
 * unit-tested directly.
 */

/** A legal move as staging takes it: its UCI, SAN and the position after it. */
type PlayedMove = { uci: string; san: string; fenAfter: string };

/** The SAN and resulting position of `uci` from `fen`, or null when it isn't legal there. */
export function playUci(fen: string, uci: string): { san: string; fenAfter: string } | null {
  try {
    const position = positionFromFen(fen);
    const move = parseUci(uci);
    if (!move || !position.isLegal(move)) return null;
    const san = makeSanAndPlay(position, move);
    return { san, fenAfter: makeFen(position.toSetup()) };
  } catch {
    return null;
  }
}

/** `ucis` played one after another from `fen`; null when one isn't legal where it's played. */
export function playUcis(fen: string, ucis: readonly string[]): PlayedMove[] | null {
  const moves: PlayedMove[] = [];
  let position = fen;
  for (const uci of ucis) {
    const played = playUci(position, uci);
    if (!played) return null;
    moves.push({ uci, ...played });
    position = played.fenAfter;
  }
  return moves;
}

/** A move as a line reads it: `3.e5` for White, `3…c5` for Black. */
export function moveLabel(fenBefore: string, san: string): string {
  const fields = fenBefore.trim().split(/\s+/);
  const fullmove = Number.parseInt(fields[5] ?? "1", 10);
  const number = Number.isFinite(fullmove) && fullmove > 0 ? fullmove : 1;
  return fields[1] === "b" ? `${number}…${san}` : `${number}.${san}`;
}

/**
 * The draft's tree with the staged moves hung under their parents: the tree Study shows. The
 * draft's own tree (the same array) when nothing is staged.
 */
export function treeWithStaged(
  tree: readonly MoveNode[],
  staged: readonly MoveNode[]
): readonly MoveNode[] {
  if (!staged.length) return tree;
  const ids = new Set(tree.map((node) => node.id));
  const under = new Map<string, string[]>();
  for (const node of staged) {
    if (node.parentId && ids.has(node.parentId)) {
      under.set(node.parentId, [...(under.get(node.parentId) ?? []), node.id]);
    }
  }
  return [
    ...tree.map((node) => {
      const extra = under.get(node.id);
      return extra ? { ...node, children: [...node.children, ...extra] } : node;
    }),
    ...staged
  ];
}

/**
 * The staged moves that still hang from the chapter: an undo or a deleted line can take away
 * their parent, and a move the chapter now has at the same place (a redo) replaces its staged
 * copy. The same array when every one is kept.
 */
export function liveStaged(
  tree: readonly MoveNode[],
  staged: readonly MoveNode[]
): readonly MoveNode[] {
  if (!staged.length) return staged;
  const chapter = new Map(tree.map((node) => [node.id, node]));
  const byId = new Map(staged.map((node) => [node.id, node]));
  const live = new Map<string, boolean>();
  const isLive = (node: MoveNode): boolean => {
    const known = live.get(node.id);
    if (known !== undefined) return known;
    // Marked first, so a malformed cycle ends.
    live.set(node.id, false);
    const parentId = node.parentId ?? "";
    const parent = chapter.get(parentId);
    const result = parent
      ? !parent.children.some((id) => chapter.get(id)?.uci === node.uci)
      : byId.has(parentId) && isLive(byId.get(parentId)!);
    live.set(node.id, result);
    return result;
  };
  const kept = staged.filter(isLive);
  if (kept.length === staged.length) return staged;
  const keptIds = new Set(kept.map((node) => node.id));
  return kept.map((node) => ({
    ...node,
    children: node.children.filter((id) => keptIds.has(id))
  }));
}

/**
 * Stages `moves` (legal one after another) from `fromId` of the shown tree: a move the chapter or
 * the staged moves already have there is followed, the rest are staged. The staged moves after it
 * and the last move's id; null when `fromId` isn't shown.
 */
export function stageLine(
  tree: readonly MoveNode[],
  staged: readonly MoveNode[],
  fromId: string,
  moves: readonly PlayedMove[]
): { staged: MoveNode[]; nodeId: string } | null {
  const shown = new Map(treeWithStaged(tree, staged).map((node) => [node.id, node]));
  const stagedIds = new Set(staged.map((node) => node.id));
  let current = shown.get(fromId);
  if (!current) return null;
  let next = [...staged];
  for (const move of moves) {
    const parent: MoveNode = current;
    const existing = parent.children
      .map((id) => shown.get(id))
      .find((child) => child?.uci === move.uci);
    if (existing) {
      current = existing;
      continue;
    }
    const node: MoveNode = {
      id: nanoid(),
      parentId: parent.id,
      san: move.san,
      uci: move.uci,
      fenBefore: parent.fenAfter,
      fenAfter: move.fenAfter,
      ply: parent.ply + 1,
      nags: [],
      comment: null,
      clockAfter: null,
      arrows: [],
      highlights: [],
      children: []
    };
    const linked = { ...parent, children: [...parent.children, node.id] };
    shown.set(parent.id, linked);
    // A chapter parent gets it through treeWithStaged; a staged one lists it itself.
    if (stagedIds.has(parent.id)) {
      next = next.map((item) => (item.id === parent.id ? linked : item));
    }
    next.push(node);
    stagedIds.add(node.id);
    shown.set(node.id, node);
    current = node;
  }
  return { staged: next, nodeId: current.id };
}

/** The staged moves without `nodeId` and what follows it. */
export function dropStaged(staged: readonly MoveNode[], nodeId: string): MoveNode[] {
  const removed = new Set<string>();
  const byId = new Map(staged.map((node) => [node.id, node]));
  const stack = [nodeId];
  while (stack.length) {
    const id = stack.pop()!;
    const node = byId.get(id);
    if (!node || removed.has(id)) continue;
    removed.add(id);
    stack.push(...node.children);
  }
  return staged
    .filter((node) => !removed.has(node.id))
    .map((node) =>
      node.children.some((id) => removed.has(id))
        ? { ...node, children: node.children.filter((id) => !removed.has(id)) }
        : node
    );
}

/**
 * What an added move becomes: the player's a practised move (study-only with `studyOnly`), the
 * opponent's a covered reply.
 */
function addedEdge(
  fenBefore: string,
  color: RepertoireColor,
  studyOnly: boolean
): RepertoireNodeMeta["edge"] {
  if (playerToMove(fenBefore) !== color) return "covered";
  return studyOnly ? "reference" : "included";
}

/** The chapter with the staged moves added (keeping their ids), as Add makes it. */
export function chapterWithStaged(
  chapter: RepertoireChapter,
  staged: readonly MoveNode[],
  color: RepertoireColor,
  { studyOnly = false }: { studyOnly?: boolean } = {}
): RepertoireChapter {
  const live = liveStaged(chapter.tree, staged);
  if (!live.length) return chapter;
  return {
    ...chapter,
    tree: [...treeWithStaged(chapter.tree, live)],
    nodeMeta: {
      ...chapter.nodeMeta,
      ...Object.fromEntries(
        live.map((node) => [node.id, { edge: addedEdge(node.fenBefore, color, studyOnly) }])
      )
    }
  };
}

/** The chapter as Study shows it: the staged moves in its tree, study-only until added. */
export function shownChapter(
  chapter: RepertoireChapter,
  staged: readonly MoveNode[]
): RepertoireChapter {
  if (!staged.length) return chapter;
  return {
    ...chapter,
    tree: [...treeWithStaged(chapter.tree, staged)],
    nodeMeta: {
      ...chapter.nodeMeta,
      ...Object.fromEntries(staged.map((node) => [node.id, { edge: "reference" as const }]))
    }
  };
}

/**
 * The staged lines as UCI moves from the chapter's root, one per staged move that ends a line:
 * what adding them to another chapter replays there.
 */
export function stagedLines(tree: readonly MoveNode[], staged: readonly MoveNode[]): string[][] {
  const live = liveStaged(tree, staged);
  const shown = new Map(treeWithStaged(tree, live).map((node) => [node.id, node]));
  return live
    .filter((node) => !node.children.length)
    .map((leaf) => {
      const ucis: string[] = [];
      for (let node = shown.get(leaf.id); node?.uci; node = shown.get(node.parentId ?? "")) {
        ucis.push(node.uci);
      }
      return ucis.reverse();
    });
}

/**
 * Adds `lines` (UCI moves from `rootFen`, another chapter's start) to `chapter`, each from the
 * deepest of its positions the chapter reaches (its root when they start alike; a transposition
 * otherwise). Moves the chapter has are followed and keep their kind; new ones get Add's. The
 * chapter (the same object when it has every line already) and the last line's end; null when a
 * line reaches none of the chapter's positions or isn't legal.
 */
export function chapterWithLines(
  chapter: RepertoireChapter,
  {
    rootFen,
    lines,
    color,
    studyOnly = false
  }: {
    rootFen: string;
    lines: readonly (readonly string[])[];
    color: RepertoireColor;
    studyOnly?: boolean;
  }
): { chapter: RepertoireChapter; nodeId: string } | null {
  let tree = chapter.tree;
  const nodeMeta = { ...chapter.nodeMeta };
  let nodeId: string = REPERTOIRE_ROOT_NODE_ID;
  for (const line of lines) {
    const moves = playUcis(rootFen, line);
    if (!moves) return null;
    const lookup = buildChapterLookup({ tree });
    const nodeAt = new Map<string, string>();
    for (const id of lookup.order) {
      const key = lookup.positionKeys.get(id)!;
      if (!nodeAt.has(key)) nodeAt.set(key, id);
    }
    const fens = [rootFen, ...moves.map((move) => move.fenAfter)];
    let start = -1;
    let parentId = "";
    for (let index = fens.length - 1; index >= 0 && start === -1; index -= 1) {
      const found = keyOf(fens[index]);
      const id = found ? nodeAt.get(found) : undefined;
      if (id) {
        start = index;
        parentId = id;
      }
    }
    if (start === -1) return null;
    for (const move of moves.slice(start)) {
      const parent = tree.find((node) => node.id === parentId)!;
      const added = addMoveNode(tree, parentId, {
        san: move.san,
        uci: move.uci,
        fenBefore: parent.fenAfter,
        fenAfter: move.fenAfter
      });
      if (added.moveTree !== tree) {
        nodeMeta[added.node.id] = { edge: addedEdge(parent.fenAfter, color, studyOnly) };
      }
      tree = added.moveTree;
      parentId = added.node.id;
    }
    nodeId = parentId;
  }
  // Lines the chapter has already: the chapter itself (no edit, so no undo step or save).
  if (tree === chapter.tree) return { chapter, nodeId };
  return { chapter: { ...chapter, tree, nodeMeta }, nodeId };
}

/** The position key of `fen`, or null when it can't be read. */
function keyOf(fen: string): string | null {
  try {
    return positionKey(fen);
  } catch {
    return null;
  }
}

/** The New moves card: the staged moves as chips, what Add changes, and its practice count. */
export type StagedSummary = {
  /** The staged moves in the tree's order, labelled as a line reads them. */
  chips: { nodeId: string; label: string }[];
  /** One sentence per decision Add changes. */
  sentences: string[];
  /** The player's moves Add makes practised. */
  practiceMoves: number;
};

/**
 * What adding the staged moves (as practised) would change: per move of the player's, whether it
 * becomes your move or another one where you already play some (in this chapter, or practised by
 * another: `practisedElsewhere`, UCI moves by position key); per opponent move, a reply you prepare
 * for, or one still waiting for your answer; moves under a study-only line stay study-only.
 * `transposesTo`: another chapter the line's end reaches already.
 */
export function stagedSummary({
  chapter,
  staged,
  color,
  practisedElsewhere = {},
  transposesTo = null
}: {
  chapter: RepertoireChapter;
  staged: readonly MoveNode[];
  color: RepertoireColor;
  practisedElsewhere?: Readonly<Record<string, readonly string[]>>;
  transposesTo?: string | null;
}): StagedSummary {
  const live = liveStaged(chapter.tree, staged);
  const summary: StagedSummary = { chips: [], sentences: [], practiceMoves: 0 };
  if (!live.length) return summary;
  const ids = new Set(live.map((node) => node.id));
  const next = chapterWithStaged(chapter, live, color);
  const lookup = buildChapterLookup(next);
  const kinds = moveKinds(next, lookup, color);
  const childrenOf = (id: string) =>
    (lookup.childrenById.get(id) ?? []).map((childId) => lookup.nodesById.get(childId)!);
  for (const id of lookup.order) {
    if (!ids.has(id)) continue;
    const node = lookup.nodesById.get(id)!;
    const label = moveLabel(node.fenBefore, node.san ?? node.uci ?? "?");
    summary.chips.push({ nodeId: id, label });
    const kind = kinds.get(id);
    if (kind === "reference") {
      summary.sentences.push(`${label} is added as study-only: this line isn't practised.`);
    } else if (playerToMove(node.fenBefore) === color) {
      summary.practiceMoves += 1;
      const siblings = childrenOf(node.parentId!).filter(
        (child) => child.id !== id && kinds.get(child.id) === "yours"
      );
      const known = new Set([node.uci, ...siblings.map((child) => child.uci)]);
      const parentKey = lookup.positionKeys.get(node.parentId!) ?? "";
      const elsewhere = (practisedElsewhere[parentKey] ?? []).filter((uci) => !known.has(uci));
      const others = [
        ...siblings.map((child) => moveLabel(child.fenBefore, child.san ?? child.uci!)),
        ...elsewhere.map((uci) => moveLabel(node.fenBefore, sanOf(node.fenBefore, uci)))
      ];
      summary.sentences.push(
        others.length
          ? `${label} becomes another move of yours here (you also play ${others.join(", ")}).`
          : `${label} becomes your move here.`
      );
    } else {
      const answered = childrenOf(id).some((child) => kinds.get(child.id) === "yours");
      summary.sentences.push(
        answered
          ? `${label} becomes a reply you prepare for.`
          : `${label} is a reply you'll cover; play your answer to practise it.`
      );
    }
  }
  if (transposesTo) {
    summary.sentences.push(`Already in ${transposesTo} — sidelines by transposition.`);
  }
  return summary;
}
