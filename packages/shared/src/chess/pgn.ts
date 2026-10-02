import { nanoid } from "nanoid";
import { parseComment, parsePgn, startingPosition } from "chessops/pgn";
import type { ChildNode, PgnNodeData } from "chessops/pgn";
import { makeFen } from "chessops/fen";
import { parseAnnotationComment, serializeAnnotationComment } from "./annotations";
import { applySan, START_FEN } from "./position";
import type { Color, GameHeaders, GameSession, ImportedGame, MoveNode } from "../types/chess";

const ROOT_ID = "root";

export function createEmptyGame(): GameSession {
  const root = createRootNode(START_FEN);
  return {
    id: null,
    source: "new",
    headers: { result: "*" },
    rootFen: START_FEN,
    currentFen: START_FEN,
    currentNodeId: ROOT_ID,
    moveTree: [root],
    pgn: "*"
  };
}

export function createGameFromFen(input: {
  fen: string;
  source?: GameSession["source"];
  headers?: GameHeaders;
}): GameSession {
  const root = createRootNode(input.fen);
  return {
    id: null,
    source: input.source ?? "new",
    headers: { result: "*", ...input.headers },
    rootFen: input.fen,
    currentFen: input.fen,
    currentNodeId: ROOT_ID,
    moveTree: [root],
    pgn: headersToPgn({ result: "*", ...input.headers }, input.fen)
      .concat(["", "*"])
      .join("\n")
  };
}

/**
 * `strict` refuses a game with a move that can't be played (rather than dropping that move and
 * everything after it), for restoring a stored game where a shorter tree would lose moves.
 */
export function importPgnText(pgn: string, { strict = false }: { strict?: boolean } = {}): ImportedGame {
  const games = parsePgn(pgn);
  if (!games.length) throw new Error("No PGN game found");

  const game = games[0];
  const starting = startingPosition(game.headers).unwrap();
  const rootFen = makeFen(starting.toSetup());
  const headers = headersFromMap(game.headers);
  const root = createRootNode(rootFen);
  const moveTree: MoveNode[] = [root];

  const byId = new Map<string, MoveNode>([[ROOT_ID, root]]);
  for (const child of game.moves.children) {
    appendPgnChild(moveTree, byId, ROOT_ID, rootFen, root.ply, child, strict);
  }

  // Imported games open on the last mainline move.
  let current = root;
  for (let nextId = current.children[0]; nextId; nextId = current.children[0]) {
    const next = byId.get(nextId);
    if (!next) break;
    current = next;
  }
  const currentNodeId = current.id;
  const currentNode = current;
  return {
    game: {
      id: null,
      source: "pgn-import",
      headers,
      rootFen,
      currentFen: currentNode.fenAfter,
      currentNodeId,
      moveTree,
      pgn: exportGameToPgn({ headers, moveTree })
    },
    warning: games.length > 1 ? "Imported the first PGN game only." : undefined
  };
}

export function exportGameToPgn(input: { headers: GameHeaders; moveTree: MoveNode[] }): string {
  const byId = indexMoveTree(input.moveTree);
  const root = byId.get(ROOT_ID);
  const lines = headersToPgn(input.headers, root?.fenBefore);
  const body = root ? serializeChildren(byId, root) : "";
  const result = input.headers.result || "*";
  lines.push("");
  lines.push(`${body ? `${body} ` : ""}${result}`.trim());
  return lines.join("\n");
}

export function addMoveNode(
  moveTree: MoveNode[],
  parentId: string,
  san: string,
  uci: string,
  fenBefore: string,
  fenAfter: string
): { moveTree: MoveNode[]; node: MoveNode } {
  const existing = moveTree.find((node) => node.parentId === parentId && node.uci === uci);
  if (existing) return { moveTree, node: existing };

  const parent = moveTree.find((node) => node.id === parentId);
  if (!parent) throw new Error("Parent node not found");

  const node: MoveNode = {
    id: nanoid(),
    parentId,
    san,
    uci,
    fenBefore,
    fenAfter,
    ply: parent.ply + 1,
    nags: [],
    comment: null,
    clockAfter: null,
    arrows: [],
    highlights: [],
    children: []
  };

  return {
    moveTree: moveTree
      .map((item) =>
        item.id === parentId ? { ...item, children: [...item.children, node.id] } : item
      )
      .concat(node),
    node
  };
}

/** Lichess / chessops clock parsing ([%clk …] as seconds), with regex fallback. */
function clockAfterFromCommentBlob(blob: string, regexFallback: string | null): string | null {
  const raw = blob.replace(/\uFF05/g, "%").trim();
  if (!raw) return regexFallback;
  const parsed = parseComment(raw);
  if (parsed.clock !== undefined) return formatSecondsAsClk(parsed.clock);
  return regexFallback;
}

/** Matches chessops `makeClk` display (hours:mins:secs with optional fraction). */
function formatSecondsAsClk(seconds: number): string {
  let s = Math.max(0, seconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  s = (s % 3600) % 60;
  return `${hours}:${minutes.toString().padStart(2, "0")}:${s.toLocaleString("en", {
    minimumIntegerDigits: 2,
    maximumFractionDigits: 3
  })}`;
}

function appendPgnChild(
  moveTree: MoveNode[],
  byId: Map<string, MoveNode>,
  parentId: string,
  fenBefore: string,
  ply: number,
  child: ChildNode<PgnNodeData>,
  strict: boolean
): void {
  const applied = applySan(fenBefore, child.data.san);
  if (!applied) {
    if (strict) throw new Error(`Illegal move in PGN: ${child.data.san}`);
    return;
  }
  const comments = [...(child.data.startingComments ?? []), ...(child.data.comments ?? [])];
  const commentBlob = comments.join(" ");
  const annotation = parseAnnotationComment(commentBlob);
  const node: MoveNode = {
    id: nanoid(),
    parentId,
    san: applied.san,
    uci: applied.uci,
    fenBefore,
    fenAfter: applied.fen,
    ply: ply + 1,
    nags: (child.data.nags ?? []).map((nag) => `$${nag}`),
    comment: annotation.text,
    clockAfter: clockAfterFromCommentBlob(commentBlob, annotation.clock),
    arrows: annotation.arrows,
    highlights: annotation.highlights,
    children: []
  };

  byId.get(parentId)?.children.push(node.id);
  moveTree.push(node);
  byId.set(node.id, node);

  for (const grandChild of child.children) {
    appendPgnChild(moveTree, byId, node.id, applied.fen, node.ply, grandChild, strict);
  }
}

function indexMoveTree(moveTree: readonly MoveNode[]): Map<string, MoveNode> {
  return new Map(moveTree.map((node) => [node.id, node]));
}

/**
 * Writes the moves after `parent`: its main continuation, with each alternative to a move in
 * parentheses right after that move (`1. e4 e5 (1... c5) 2. Nf3`). Move numbers and the mover come
 * from the ply, which counts from the game's real start (see `rootPly`).
 */
function serializeChildren(
  byId: ReadonlyMap<string, MoveNode>,
  parent: MoveNode,
  needsNumber = true
): string {
  const parts: string[] = [];
  for (let from: MoveNode | undefined = parent; from; ) {
    const [mainId, ...alternativeIds]: string[] = from.children;
    const main: MoveNode | undefined = mainId ? byId.get(mainId) : undefined;
    if (!main?.san) break;
    pushMove(parts, main, needsNumber);
    needsNumber = false;
    for (const alternativeId of alternativeIds) {
      const alternative = byId.get(alternativeId);
      if (!alternative?.san) continue;
      const line: string[] = [];
      pushMove(line, alternative, true);
      const rest = serializeChildren(byId, alternative, false);
      if (rest) line.push(rest);
      parts.push(`(${line.join(" ")})`);
      // After a variation, Black's reply needs its number again (`2. Nf3 (2. d4) 2... Nc6`).
      needsNumber = true;
    }
    from = main;
  }
  return parts.join(" ");
}

function pushMove(parts: string[], node: MoveNode, needsNumber: boolean): void {
  const moveNumber = Math.ceil(node.ply / 2);
  if (node.ply % 2 === 1) parts.push(`${moveNumber}.`);
  else if (needsNumber) parts.push(`${moveNumber}...`);
  parts.push(node.san ?? "");
  if (node.nags.length) parts.push(...node.nags);
  const comment = serializeAnnotationComment(node.comment, node.arrows, node.highlights, node.clockAfter);
  if (comment) parts.push(`{ ${comment} }`);
}

function headersFromMap(headers: Map<string, string>): GameHeaders {
  const get = (key: string) => headers.get(key) ?? null;
  return {
    event: get("Event"),
    site: get("Site"),
    date: get("Date"),
    round: get("Round"),
    white: get("White"),
    black: get("Black"),
    whiteElo: get("WhiteElo"),
    blackElo: get("BlackElo"),
    timeControl: get("TimeControl"),
    eco: get("ECO"),
    opening: get("Opening"),
    utcDate: get("UTCDate"),
    utcTime: get("UTCTime"),
    termination: get("Termination"),
    result: get("Result") ?? "*",
    orientationHint: parseOrientationHint(get("Orientation"))
  };
}

function parseOrientationHint(raw: string | null): Color | null {
  if (!raw?.trim()) return null;
  const v = raw.trim().toLowerCase();
  if (v === "black") return "black";
  if (v === "white") return "white";
  return null;
}

function headersToPgn(headers: GameHeaders, rootFen?: string): string[] {
  const lines: string[] = [];
  lines.push(`[Event "${escapeHeader(headers.event || "?")}"]`);
  lines.push(`[Site "${escapeHeader(headers.site || "?")}"]`);
  lines.push(`[Date "${escapeHeader(headers.date || "????.??.??")}"]`);
  lines.push(`[Round "${escapeHeader(headers.round || "?")}"]`);
  lines.push(`[White "${escapeHeader(headers.white || "White")}"]`);
  if (headers.whiteElo) lines.push(`[WhiteElo "${escapeHeader(headers.whiteElo)}"]`);
  lines.push(`[Black "${escapeHeader(headers.black || "Black")}"]`);
  if (headers.blackElo) lines.push(`[BlackElo "${escapeHeader(headers.blackElo)}"]`);
  if (headers.timeControl) lines.push(`[TimeControl "${escapeHeader(headers.timeControl)}"]`);
  if (headers.eco) lines.push(`[ECO "${escapeHeader(headers.eco)}"]`);
  if (headers.opening) lines.push(`[Opening "${escapeHeader(headers.opening)}"]`);
  if (headers.utcDate) lines.push(`[UTCDate "${escapeHeader(headers.utcDate)}"]`);
  if (headers.utcTime) lines.push(`[UTCTime "${escapeHeader(headers.utcTime)}"]`);
  if (headers.termination) lines.push(`[Termination "${escapeHeader(headers.termination)}"]`);
  if (headers.orientationHint)
    lines.push(`[Orientation "${escapeHeader(headers.orientationHint)}"]`);
  lines.push(`[Result "${escapeHeader(headers.result || "*")}"]`);
  if (rootFen && rootFen !== START_FEN) {
    lines.push('[SetUp "1"]');
    lines.push(`[FEN "${escapeHeader(rootFen)}"]`);
  }
  return lines;
}

function escapeHeader(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Plies played before `fen` (the start position is 0), so a move's ply keeps its real number and
 * parity: an odd ply is White's move, and its move number is `ceil(ply / 2)`.
 */
export function rootPly(fen: string): number {
  const [, turn, , , , fullmoveField] = fen.trim().split(/\s+/);
  const fullmove = Number(fullmoveField);
  const moves = Number.isInteger(fullmove) && fullmove > 0 ? fullmove - 1 : 0;
  return moves * 2 + (turn === "b" ? 1 : 0);
}

/**
 * Games saved before plies counted from the real start have a root at ply 0 even when the root
 * position is, say, Black to move at move 42. Shift such a tree so numbering and movers are right.
 */
export function withRealPlies(moveTree: MoveNode[]): MoveNode[] {
  const shift = legacyPlyShift(moveTree);
  return shift ? moveTree.map((node) => ({ ...node, ply: node.ply + shift })) : moveTree;
}

/** How far `withRealPlies` moves this tree's plies (0 for trees that already count from the real start). */
export function legacyPlyShift(moveTree: readonly MoveNode[]): number {
  const root = moveTree.find((node) => node.id === ROOT_ID);
  return root ? rootPly(root.fenBefore) - root.ply : 0;
}

function createRootNode(fen: string): MoveNode {
  return {
    id: ROOT_ID,
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

/** Latest remaining times on the path from root to `nodeId`, from `[%clk]` on each move. */
export function clocksOnPathToNode(
  moveTree: MoveNode[],
  nodeId: string
): {
  white: string | null;
  black: string | null;
} {
  const byId = indexMoveTree(moveTree);
  const path: MoveNode[] = [];
  let id: string | null = nodeId;
  while (id) {
    const node = byId.get(id);
    if (!node) break;
    path.push(node);
    id = node.parentId;
  }
  path.reverse();

  let white: string | null = null;
  let black: string | null = null;
  for (const node of path) {
    if (node.id === ROOT_ID) continue;
    const c = node.clockAfter ?? null;
    if (!c) continue;
    if (node.ply % 2 === 1) white = c;
    else black = c;
  }
  return { white, black };
}

/** Resolve which move node matches the saved board (best-effort when only FEN is persisted). */
export function nodeIdForBoardFen(moveTree: MoveNode[], fen: string, fallbackId: string): string {
  const matches = moveTree.filter((n) => n.fenAfter === fen);
  if (!matches.length) return fallbackId;
  return matches.reduce((a, b) => (a.ply >= b.ply ? a : b)).id;
}
