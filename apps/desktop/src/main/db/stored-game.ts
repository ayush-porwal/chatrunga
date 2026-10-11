/**
 * A stored game's move tree and headers read back: checked node by node, and rebuilt from the
 * game's PGN (with its review moved onto the rebuilt tree) when the stored tree is damaged.
 */
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import { positionFromFen } from "@chaturanga/shared/chess/position";
import type { GameHeaders, MoveNode } from "@chaturanga/shared/types/chess";
import type { GameReview } from "@chaturanga/shared/types/engine";
import { isRecord } from "@chaturanga/shared/types/guards";

/**
 * The stored move tree. A damaged one is rebuilt from the row's PGN; if that fails too, opening
 * the game fails, rather than showing an empty board that autosave would then write over the
 * stored PGN (the only copy left of the moves).
 */
export function parseMoveTree(row: { move_tree_json: string; pgn: string }): {
  moveTree: MoveNode[];
  rebuilt: boolean;
} {
  try {
    const parsed: unknown = JSON.parse(row.move_tree_json);
    if (Array.isArray(parsed) && isConsistentTree(parsed))
      return { moveTree: parsed, rebuilt: false };
  } catch {
    // Fall through to the PGN.
  }
  try {
    // Strict: a PGN with a move that can't be played would rebuild only part of the game.
    return { moveTree: importPgnText(row.pgn, { strict: true }).game.moveTree, rebuilt: true };
  } catch {
    throw new Error("This saved game is damaged and can't be opened.");
  }
}

/**
 * A review saved with a tree that had to be rebuilt: its moves point at the old node ids, so they
 * are moved onto the rebuilt main line by ply (the position after each move must match). A review
 * that doesn't fit the rebuilt game is dropped rather than shown against the wrong moves.
 */
export function remapReviewToTree(
  review: GameReview,
  moveTree: readonly MoveNode[]
): GameReview | null {
  // By the node's own ply (absolute: a game from a set-up position starts past 0), not the index.
  const byPly = new Map(mainlineOf(moveTree).map((node) => [node.ply, node]));
  const moves = [];
  // The review is stored JSON: a damaged entry drops the review (it can't be placed), never the game.
  for (const move of review.moves) {
    if (!isRecord(move)) return null;
    const { ply, fenAfter }: { ply: unknown; fenAfter: unknown } = move;
    if (typeof ply !== "number" || !Number.isInteger(ply) || typeof fenAfter !== "string")
      return null;
    const target = byPly.get(ply);
    if (!target || target.fenAfter !== fenAfter) return null;
    moves.push({ ...move, nodeId: target.id });
  }
  return { ...review, moves };
}

/** Root, then the first child at every step. */
function mainlineOf(moveTree: readonly MoveNode[]): MoveNode[] {
  const byId = new Map(moveTree.map((node) => [node.id, node]));
  const line: MoveNode[] = [];
  let node = moveTree.find((item) => item.parentId === null);
  while (node) {
    line.push(node);
    node = node.children[0] ? byId.get(node.children[0]) : undefined;
  }
  return line;
}

/**
 * The cursor in a tree rebuilt from the PGN: the old node id is gone, and which occurrence of a
 * repeated position it was can't be told from a damaged tree. The main-line node showing the saved
 * position (its last occurrence), else the end of the main line.
 */
export function rebuiltCursor(moveTree: readonly MoveNode[], currentFen: string): string | null {
  const line = mainlineOf(moveTree);
  for (let index = line.length - 1; index >= 0; index -= 1) {
    if (line[index].fenAfter === currentFen) return line[index].id;
  }
  return line.at(-1)?.id ?? null;
}

/** The root's id in every tree the app builds (createEmptyGame, importPgnText). */
const ROOT_NODE_ID = "root";

const isString = (value: unknown): value is string => typeof value === "string";
const isStringOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

/** Every field a move node needs, with its type. Only the root has no move (san/uci null). */
const SQUARE = /^[a-h][1-8]$/;
const ANNOTATION_COLORS: readonly unknown[] = ["green", "red", "yellow", "blue"];

function isArrow(value: unknown): boolean {
  return (
    isRecord(value) &&
    SQUARE.test(String(value.orig)) &&
    SQUARE.test(String(value.dest)) &&
    ANNOTATION_COLORS.includes(value.color)
  );
}

function isHighlight(value: unknown): boolean {
  return (
    isRecord(value) && SQUARE.test(String(value.square)) && ANNOTATION_COLORS.includes(value.color)
  );
}

/** A position the board can show (the board and move list read it as soon as the node is selected). */
function isPlayableFen(fen: unknown, checked: Map<string, boolean>): boolean {
  if (typeof fen !== "string") return false;
  let ok = checked.get(fen);
  if (ok === undefined) {
    try {
      positionFromFen(fen);
      ok = true;
    } catch {
      ok = false;
    }
    checked.set(fen, ok);
  }
  return ok;
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);

/** Where the node sits and its move: ids, the move (none at the root), positions and ply. */
function isPlacedMove(node: Record<string, unknown>, fens: Map<string, boolean>): boolean {
  const root = node.id === ROOT_NODE_ID;
  return (
    isString(node.id) &&
    (root ? node.parentId === null : isString(node.parentId)) &&
    (root
      ? isStringOrNull(node.san) && isStringOrNull(node.uci)
      : isString(node.san) && isString(node.uci)) &&
    isPlayableFen(node.fenBefore, fens) &&
    isPlayableFen(node.fenAfter, fens) &&
    Number.isInteger(node.ply) &&
    isStringArray(node.children)
  );
}

/** What is noted on the move: NAGs, comment, clock, when it was played, arrows and highlights. */
function hasValidNotes(node: Record<string, unknown>): boolean {
  return (
    isStringArray(node.nags) &&
    isStringOrNull(node.comment) &&
    (node.clockAfter === undefined || isStringOrNull(node.clockAfter)) &&
    (node.playedAt === undefined ||
      (typeof node.playedAt === "number" && Number.isFinite(node.playedAt))) &&
    Array.isArray(node.arrows) &&
    node.arrows.every(isArrow) &&
    Array.isArray(node.highlights) &&
    node.highlights.every(isHighlight)
  );
}

function isMoveNodeLike(value: unknown, fens: Map<string, boolean> = new Map()): value is MoveNode {
  return isRecord(value) && isPlacedMove(value, fens) && hasValidNotes(value);
}

/**
 * A tree the app can use as it is: well-formed nodes with unique ids, the canonical root, and every
 * node reached from it exactly once by following children whose parent links point back — so no
 * duplicate child, cycle or stray node, and walks up through parents always end at the root.
 */
function isConsistentTree(nodes: readonly unknown[]): nodes is MoveNode[] {
  // FENs repeat (each node's fenBefore is its parent's fenAfter): each is parsed once.
  const fens = new Map<string, boolean>();
  if (!nodes.every((node) => isMoveNodeLike(node, fens))) return false;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const root = byId.get(ROOT_NODE_ID);
  if (!root || byId.size !== nodes.length) return false;
  const reached = new Set([root.id]);
  const pending = [root];
  for (let node = pending.pop(); node; node = pending.pop()) {
    for (const childId of node.children) {
      const child = byId.get(childId);
      if (!child || child.parentId !== node.id || reached.has(childId)) return false;
      reached.add(childId);
      pending.push(child);
    }
  }
  return reached.size === nodes.length;
}

/**
 * Stored headers the renderer can use: every value a string or null (orientationHint a colour).
 * Anything else drops the whole set, and opening falls back to the headers in the row's PGN.
 */
function isHeaders(value: unknown): value is GameHeaders {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, item]) =>
    key === "orientationHint"
      ? item === null || item === "white" || item === "black"
      : isStringOrNull(item)
  );
}

/** The row's stored headers, or null when it has none (older rows) or they can't be read. */
export function storedHeaders(headersJson: string | null): GameHeaders | null {
  if (!headersJson) return null;
  try {
    const parsed: unknown = JSON.parse(headersJson);
    return isHeaders(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
