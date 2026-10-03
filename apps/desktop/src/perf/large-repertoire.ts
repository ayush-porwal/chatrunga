import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSanAndPlay } from "chessops/san";
import { makeUci } from "chessops/util";
import type { Move } from "chessops/types";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type { RepertoireChapter, RepertoireColor } from "@chaturanga/shared/types/repertoire";
import { START_FEN } from "@chaturanga/shared/chess/position";
import { defaultImportNodeMeta } from "@chaturanga/shared/chess/repertoire-index";

/**
 * Representative large repertoires for the performance benchmark (design §11). Everything is
 * derived from a seeded PRNG, so a given seed always yields the same trees, games and PGN.
 */

/** Mulberry32: a small, fast, seedable PRNG returning floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function positionOf(fen: string): Chess {
  return Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
}

/** Every legal move of a position in a stable order (promotions to a queen only). */
function legalMoves(position: Chess): Move[] {
  const moves: Move[] = [];
  for (const [from, dests] of position.allDests()) {
    const piece = position.board.get(from);
    for (const to of dests) {
      const lastRank = piece?.color === "white" ? to >= 56 : to < 8;
      if (piece?.role === "pawn" && lastRank) moves.push({ from, to, promotion: "queen" });
      else moves.push({ from, to });
    }
  }
  return moves;
}

function moveNode(id: string, parent: MoveNode, move: Move): MoveNode {
  const position = positionOf(parent.fenAfter);
  const uci = makeUci(move);
  const san = makeSanAndPlay(position, move);
  return {
    id,
    parentId: parent.id,
    san,
    uci,
    fenBefore: parent.fenAfter,
    fenAfter: makeFen(position.toSetup()),
    ply: parent.ply + 1,
    nags: [],
    comment: null,
    arrows: [],
    highlights: [],
    children: []
  };
}

export type TreeShape = {
  /** Moves in the tree (the root excluded). */
  nodes: number;
  /** Length of the first (main) line in plies. */
  mainline: number;
  /** Mean length of a side line, in plies. */
  meanLine: number;
  /** No line goes deeper than this many plies from the root. */
  maxDepth: number;
};

/**
 * A chapter tree with realistic branching: a main line, then side lines of geometric length that
 * leave from random earlier nodes (so lines branch off lines, at every depth). Moves are random
 * legal moves, unique per parent.
 */
export function generateTree(random: () => number, shape: TreeShape): MoveNode[] {
  const root: MoveNode = {
    id: "root",
    parentId: null,
    san: null,
    uci: null,
    fenBefore: START_FEN,
    fenAfter: START_FEN,
    ply: 0,
    nags: [],
    comment: null,
    arrows: [],
    highlights: [],
    children: []
  };
  const tree: MoveNode[] = [root];

  /** Adds up to `length` moves below `from`; returns how many were added. */
  const grow = (from: MoveNode, length: number): number => {
    let parent = from;
    let added = 0;
    while (added < length && tree.length - 1 < shape.nodes && parent.ply < shape.maxDepth) {
      // Node `n<i>` sits at index i of the tree.
      const taken = new Set(parent.children.map((id) => tree[Number(id.slice(1))]?.uci));
      const moves = legalMoves(positionOf(parent.fenAfter)).filter(
        (move) => !taken.has(makeUci(move))
      );
      if (!moves.length) break;
      const move = moves[Math.floor(random() * moves.length)];
      const node = moveNode(`n${tree.length}`, parent, move);
      parent.children.push(node.id);
      tree.push(node);
      parent = node;
      added += 1;
    }
    return added;
  };

  grow(root, shape.mainline);
  let stalls = 0;
  while (tree.length - 1 < shape.nodes && stalls < 1000) {
    const from = tree[Math.floor(random() * tree.length)];
    // Geometric line length with the requested mean (at least one move).
    const length = Math.max(1, Math.round(-Math.log(1 - random()) * shape.meanLine));
    stalls = grow(from, length) ? 0 : stalls + 1;
  }
  return tree;
}

/** A chapter around a generated tree, with the import defaults for its node metadata. */
export function generateChapter(
  random: () => number,
  shape: TreeShape,
  options: { id: string; title: string; sortOrder: number; color: RepertoireColor }
): RepertoireChapter {
  const tree = generateTree(random, shape);
  return {
    id: options.id,
    title: options.title,
    sortOrder: options.sortOrder,
    kind: "opening",
    enabled: true,
    rootFen: START_FEN,
    revision: 1,
    nodeCount: tree.length - 1,
    dueCount: 0,
    headers: { Event: options.title },
    tree,
    nodeMeta: defaultImportNodeMeta(options.color, tree)
  };
}

/**
 * A finished game's mainline (UCI from the start) of up to `plies` moves: it follows `tree`'s main
 * line for as long as it can, then continues with random legal moves until the game ends.
 */
export function generateGame(random: () => number, tree: MoveNode[], plies: number): string[] {
  const byId = new Map(tree.map((node) => [node.id, node]));
  const moves: string[] = [];
  let node = byId.get("root");
  let fen = START_FEN;
  while (node?.children[0] && moves.length < plies) {
    node = byId.get(node.children[0])!;
    moves.push(node.uci!);
    fen = node.fenAfter;
  }
  const position = positionOf(fen);
  while (moves.length < plies) {
    const legal = legalMoves(position);
    if (!legal.length) break;
    const move = legal[Math.floor(random() * legal.length)];
    moves.push(makeUci(move));
    position.play(move);
  }
  return moves;
}

/** The tree with one random legal move added below its last leaf (a structural edit). */
export function extendLeaf(random: () => number, tree: MoveNode[]): MoveNode[] {
  const leaf = [...tree].reverse().find((node) => !node.children.length) ?? tree[0];
  const moves = legalMoves(positionOf(leaf.fenAfter));
  if (!moves.length) return tree;
  const node = moveNode(`x${tree.length}`, leaf, moves[Math.floor(random() * moves.length)]);
  return [
    ...tree.map((item) => (item.id === leaf.id ? { ...item, children: [node.id] } : item)),
    node
  ];
}
