/**
 * Deep checks of a chapter the renderer (or an import) wants stored. The renderer is untrusted:
 * every node is rebuilt from known fields, every move is replayed from its parent, and castling is
 * stored in standard king-two-squares form (`e1g1`) so accepted moves compare by plain UCI.
 */
import { makeFen } from "chessops/fen";
import { makeSanAndPlay } from "chessops/san";
import { parseUci } from "chessops/util";
import type {
  AnnotationColor,
  BoardArrow,
  BoardHighlight,
  MoveNode
} from "@chaturanga/shared/types/chess";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type RepertoireChapter,
  type RepertoireEdgeKind,
  type RepertoireNodeMeta
} from "@chaturanga/shared/types/repertoire";
import { rootPly } from "@chaturanga/shared/chess/pgn";
import { fenAfterUci, positionFromFen } from "@chaturanga/shared/chess/position";
import { standardCastlingUci } from "@chaturanga/shared/chess/review";
import { positionKey } from "@chaturanga/shared/chess/repertoire-position";

export const MAX_TREE_NODES = 100_000;
const MAX_ID = 200;
const MAX_TITLE = 200;
const MAX_COMMENT = 20_000;
const MAX_HEADERS = 64;
const MAX_HEADER_NAME = 64;
const MAX_HEADER_VALUE = 2_000;
const MAX_ANNOTATIONS = 64;
const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const SQUARE = /^[a-h][1-8]$/;
const NAG = /^\$\d{1,3}$/;
const EDGES: readonly RepertoireEdgeKind[] = ["reference", "included", "covered"];
const COLORS: ReadonlySet<string> = new Set<AnnotationColor>(["green", "red", "yellow", "blue"]);
/** A PGN tag name: letters, digits and underscores. */
const TAG_NAME = /^[A-Za-z0-9_]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
// eslint-disable-next-line no-control-regex
const CONTROL_RUNS = /[\u0000-\u001f\u007f]+/g;

type Fields = Record<string, unknown>;

function treeError(nodeId: string, reason: string): never {
  throw new Error(`Invalid chapter tree: node "${nodeId}" ${reason}`);
}

function isObject(value: unknown): value is Fields {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalText(value: unknown, max: number): string | null {
  return typeof value === "string" ? value.slice(0, max) : null;
}

/** A UCI move in the stored form: lower case, castling as the king's two-square move. */
export function normalizeUci(fen: string, uci: string): string {
  return standardCastlingUci(fen, uci.trim().toLowerCase());
}

/** The FEN after `uci`, or null when it isn't legal (or the FEN can't be read). */
export function fenAfterMove(fen: string, uci: string): string | null {
  if (!UCI_MOVE.test(uci)) return null;
  try {
    return fenAfterUci(fen, uci);
  } catch {
    return null;
  }
}

/** The FEN and SAN after `uci`, or null when it isn't legal (or the FEN can't be read). */
function playMove(fen: string, uci: string): { fen: string; san: string } | null {
  if (!UCI_MOVE.test(uci)) return null;
  try {
    const position = positionFromFen(fen);
    const move = parseUci(uci);
    if (!move || !position.isLegal(move)) return null;
    const san = makeSanAndPlay(position, move);
    return { fen: makeFen(position.toSetup()), san };
  } catch {
    return null;
  }
}

/** A FEN the chess library accepts as a legal standard position. */
export function isValidFen(fen: string): boolean {
  try {
    positionFromFen(fen);
    return true;
  } catch {
    return false;
  }
}

function sameFen(a: string, b: string): boolean {
  try {
    return positionKey(a) === positionKey(b);
  } catch {
    return false;
  }
}

function sanitizeArrows(value: unknown): BoardArrow[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_ANNOTATIONS)
    .filter(
      (arrow): arrow is BoardArrow =>
        isObject(arrow) &&
        typeof arrow.orig === "string" &&
        SQUARE.test(arrow.orig) &&
        typeof arrow.dest === "string" &&
        SQUARE.test(arrow.dest) &&
        typeof arrow.color === "string" &&
        COLORS.has(arrow.color)
    )
    .map((arrow) => ({ orig: arrow.orig, dest: arrow.dest, color: arrow.color }));
}

function sanitizeHighlights(value: unknown): BoardHighlight[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_ANNOTATIONS)
    .filter(
      (highlight): highlight is BoardHighlight =>
        isObject(highlight) &&
        typeof highlight.square === "string" &&
        SQUARE.test(highlight.square) &&
        typeof highlight.color === "string" &&
        COLORS.has(highlight.color)
    )
    .map((highlight) => ({ square: highlight.square, color: highlight.color }));
}

/** One node rebuilt from its known fields (moves and FENs are re-derived by `validateTree`). */
function sanitizeNode(value: unknown, index: number): MoveNode {
  if (!isObject(value)) treeError(String(index), "is not an object");
  const id = value.id;
  if (typeof id !== "string" || !id || id.length > MAX_ID || CONTROL_CHARS.test(id)) {
    treeError(String(index), "has no valid id");
  }
  if (value.parentId !== null && typeof value.parentId !== "string")
    treeError(id, "has no valid parent");
  if (!Array.isArray(value.children) || value.children.some((child) => typeof child !== "string")) {
    treeError(id, "has no valid children list");
  }
  if (typeof value.fenAfter !== "string") treeError(id, "has no fenAfter");
  return {
    id,
    parentId: value.parentId as string | null,
    san: null,
    uci: typeof value.uci === "string" ? value.uci : null,
    fenBefore: typeof value.fenBefore === "string" ? value.fenBefore : value.fenAfter,
    fenAfter: value.fenAfter,
    ply: 0,
    nags: Array.isArray(value.nags)
      ? value.nags
          .filter((nag): nag is string => typeof nag === "string" && NAG.test(nag))
          .slice(0, 16)
      : [],
    comment: optionalText(value.comment, MAX_COMMENT),
    clockAfter: optionalText(value.clockAfter, 32),
    arrows: sanitizeArrows(value.arrows),
    highlights: sanitizeHighlights(value.highlights),
    children: [...(value.children as string[])]
  };
}

/**
 * Validates and normalises a chapter tree rooted at `rootFen`: root id `"root"` without a parent
 * or move, consistent parent/child links, every node reachable once, every move legal from its
 * parent with the matching `fenAfter`, no two siblings playing the same move. Plies and SAN are
 * derived from the root FEN and the moves, so a stored label always matches the board. Throws `Invalid chapter tree: node "<id>" …` at the first offending node.
 */
export function validateTree(nodes: readonly unknown[], rootFen: string): MoveNode[] {
  if (!nodes.length)
    throw new Error(`Invalid chapter tree: node "${REPERTOIRE_ROOT_NODE_ID}" is missing`);
  if (nodes.length > MAX_TREE_NODES) {
    throw new Error(`Invalid chapter tree: more than ${MAX_TREE_NODES} nodes`);
  }
  const tree = nodes.map(sanitizeNode);
  const byId = new Map<string, MoveNode>();
  for (const node of tree) {
    if (byId.has(node.id)) treeError(node.id, "is listed twice");
    byId.set(node.id, node);
  }
  const root = byId.get(REPERTOIRE_ROOT_NODE_ID);
  if (!root) throw new Error(`Invalid chapter tree: node "${REPERTOIRE_ROOT_NODE_ID}" is missing`);
  if (root.parentId !== null || root.uci !== null) {
    treeError(root.id, "must have no parent and no move");
  }
  if (!sameFen(root.fenAfter, rootFen))
    treeError(root.id, "doesn't start at the chapter's root FEN");
  root.fenBefore = rootFen;
  root.fenAfter = rootFen;
  root.ply = rootPly(rootFen);
  root.san = null;

  const reached = new Set([root.id]);
  const pending = [root];
  for (let node = pending.pop(); node; node = pending.pop()) {
    const seenMoves = new Set<string>();
    for (const childId of node.children) {
      const child = byId.get(childId);
      if (!child) treeError(node.id, `lists a missing child "${childId}"`);
      if (child.parentId !== node.id) treeError(childId, "has the wrong parent");
      if (reached.has(childId)) treeError(childId, "is reachable twice");
      if (!child.uci || !UCI_MOVE.test(child.uci.toLowerCase()))
        treeError(childId, "has no valid UCI move");
      const uci = normalizeUci(node.fenAfter, child.uci);
      const played = playMove(node.fenAfter, uci);
      if (!played) treeError(childId, `plays an illegal move (${child.uci})`);
      const fen = played.fen;
      if (child.fenAfter !== fen && !sameFen(child.fenAfter, fen)) {
        treeError(childId, "has a fenAfter that doesn't follow from its move");
      }
      if (seenMoves.has(uci)) treeError(childId, `repeats a sibling's move (${uci})`);
      seenMoves.add(uci);
      child.uci = uci;
      child.san = played.san;
      child.fenBefore = node.fenAfter;
      child.fenAfter = fen;
      child.ply = node.ply + 1;
      reached.add(childId);
      pending.push(child);
    }
  }
  if (reached.size !== tree.length) {
    const orphan = tree.find((node) => !reached.has(node.id))!;
    treeError(orphan.id, "is not connected to the root");
  }
  return tree;
}

/** Metadata for nodes of `tree` only (entries for removed nodes are dropped). */
export function sanitizeNodeMeta(
  value: unknown,
  tree: readonly MoveNode[]
): Record<string, RepertoireNodeMeta> {
  if (!isObject(value)) throw new Error("Invalid chapter metadata: expected an object");
  const ids = new Set(tree.map((node) => node.id));
  // A null prototype stores an id such as "__proto__" as a plain entry.
  const meta: Record<string, RepertoireNodeMeta> = Object.create(null);
  for (const [id, entry] of Object.entries(value)) {
    if (!ids.has(id)) continue;
    if (!isObject(entry) || !EDGES.includes(entry.edge as RepertoireEdgeKind)) {
      throw new Error(`Invalid chapter metadata: node "${id}" has no valid edge kind`);
    }
    const next: RepertoireNodeMeta = { edge: entry.edge as RepertoireEdgeKind };
    if (entry.trainingStart === true) next.trainingStart = true;
    if (entry.trainingStop === true) next.trainingStop = true;
    if (entry.disabled === true) next.disabled = true;
    meta[id] = next;
  }
  return meta;
}

/** Text on one line: each run of line breaks or other control characters becomes a space. */
function singleLine(text: string): string {
  return text.replace(CONTROL_RUNS, " ");
}

/**
 * PGN tags as stored: names in PGN tag syntax, string values on one line (so an exported tag can't
 * break or add tag lines), bounded in count and length.
 */
export function sanitizeHeaders(value: unknown): Record<string, string> {
  if (!isObject(value)) return {};
  const headers: Record<string, string> = {};
  for (const [name, text] of Object.entries(value)) {
    if (Object.keys(headers).length >= MAX_HEADERS) break;
    if (typeof text !== "string" || name.length > MAX_HEADER_NAME || !TAG_NAME.test(name)) continue;
    headers[name] = singleLine(text.slice(0, MAX_HEADER_VALUE));
  }
  return headers;
}

/** A chapter title: on one line (it is exported as the Event tag), trimmed, bounded, never empty. */
export function chapterTitle(value: unknown, fallback = "Untitled chapter"): string {
  const title = typeof value === "string" ? singleLine(value).trim().slice(0, MAX_TITLE) : "";
  return title || fallback;
}

/**
 * The chapter as it will be stored: fields rebuilt and checked, tree validated (see
 * `validateTree`), metadata pruned to existing nodes. `revision` is the chapter's next revision.
 */
export function sanitizeChapter(chapter: RepertoireChapter, revision: number): RepertoireChapter {
  if (!isObject(chapter)) throw new Error("Invalid chapter: expected an object");
  const rootFen = typeof chapter.rootFen === "string" ? chapter.rootFen.trim() : "";
  if (!rootFen || !isValidFen(rootFen))
    throw new Error("Invalid chapter rootFen: not a legal position");
  if (chapter.kind !== "opening" && chapter.kind !== "reference") {
    throw new Error("Invalid chapter kind: expected opening or reference");
  }
  if (!Array.isArray(chapter.tree)) throw new Error("Invalid chapter tree: expected an array");
  const tree = validateTree(chapter.tree, rootFen);
  return {
    id: chapter.id,
    title: chapterTitle(chapter.title),
    sortOrder: Number.isFinite(chapter.sortOrder) ? Math.trunc(chapter.sortOrder) : 0,
    kind: chapter.kind,
    enabled: chapter.enabled !== false,
    rootFen,
    revision,
    nodeCount: tree.length - 1,
    dueCount: 0,
    headers: sanitizeHeaders(chapter.headers),
    tree,
    nodeMeta: sanitizeNodeMeta(chapter.nodeMeta ?? {}, tree)
  };
}

/** The single root node of a new chapter at `fen`. */
export function rootNode(fen: string): MoveNode {
  return {
    id: REPERTOIRE_ROOT_NODE_ID,
    parentId: null,
    san: null,
    uci: null,
    fenBefore: fen,
    fenAfter: fen,
    ply: rootPly(fen),
    nags: [],
    comment: null,
    clockAfter: null,
    arrows: [],
    highlights: [],
    children: []
  };
}
