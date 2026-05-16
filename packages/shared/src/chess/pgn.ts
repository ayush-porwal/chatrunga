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
    pgn: headersToPgn({ result: "*", ...input.headers }).concat(["", "*"]).join("\n")
  };
}

export function importPgnText(pgn: string): ImportedGame {
  const games = parsePgn(pgn);
  if (!games.length) throw new Error("No PGN game found");

  const game = games[0];
  const starting = startingPosition(game.headers).unwrap();
  const rootFen = makeFen(starting.toSetup());
  const headers = headersFromMap(game.headers);
  const root = createRootNode(rootFen);
  const moveTree: MoveNode[] = [root];

  for (const child of game.moves.children) {
    appendPgnChild(moveTree, ROOT_ID, rootFen, 0, child);
  }

  let currentNodeId = ROOT_ID;
  if ([...game.moves.mainline()].length) {
    let cursor = ROOT_ID;
    for (const child of game.moves.mainlineNodes()) {
      const parent = moveTree.find((item) => item.id === cursor);
      if (!parent) break;
      const applied = applySan(parent.fenAfter, child.data.san);
      if (!applied) break;
      const node = moveTree.find(
        (item) => item.parentId === cursor && item.uci === applied.uci
      );
      if (!node) break;
      cursor = node.id;
    }
    currentNodeId = cursor;
  }

  const currentNode = moveTree.find((node) => node.id === currentNodeId) ?? root;
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
  const lines = headersToPgn(input.headers);
  const body = serializeChildren(input.moveTree, ROOT_ID);
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
    moveTree: moveTree.map((item) =>
      item.id === parentId ? { ...item, children: [...item.children, node.id] } : item
    ).concat(node),
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
  parentId: string,
  fenBefore: string,
  ply: number,
  child: ChildNode<PgnNodeData>
): void {
  const applied = applySan(fenBefore, child.data.san);
  if (!applied) return;
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

  const parent = moveTree.find((item) => item.id === parentId);
  if (parent) parent.children.push(node.id);
  moveTree.push(node);

  for (const grandChild of child.children) {
    appendPgnChild(moveTree, node.id, applied.fen, node.ply, grandChild);
  }
}

function serializeChildren(moveTree: MoveNode[], parentId: string): string {
  const parent = moveTree.find((node) => node.id === parentId);
  if (!parent) return "";

  const parts: string[] = [];
  parent.children.forEach((childId, index) => {
    const child = moveTree.find((node) => node.id === childId);
    if (!child || !child.san) return;
    if (index > 0) {
      const variation = serializeLine(moveTree, child);
      if (variation) parts.push(`(${variation})`);
      return;
    }
    const line = serializeLine(moveTree, child);
    if (line) parts.push(line);
  });
  return parts.join(" ");
}

function serializeLine(moveTree: MoveNode[], first: MoveNode): string {
  const parts: string[] = [];
  let node: MoveNode | undefined = first;
  while (node) {
    if (node.ply % 2 === 1) parts.push(`${Math.floor(node.ply / 2) + 1}.`);
    else if (!parts.length) parts.push(`${Math.floor(node.ply / 2)}...`);
    parts.push(node.san ?? "");
    if (node.nags.length) parts.push(...node.nags);
    const comment = serializeAnnotationComment(
      node.comment,
      node.arrows,
      node.highlights,
      node.clockAfter
    );
    if (comment) parts.push(`{ ${comment} }`);

    const variations = node.children.slice(1);
    for (const variationId of variations) {
      const variation = moveTree.find((item) => item.id === variationId);
      if (variation) parts.push(`(${serializeLine(moveTree, variation)})`);
    }

    const nextId: string | undefined = node.children[0];
    node = nextId ? moveTree.find((item) => item.id === nextId) : undefined;
  }
  return parts.join(" ");
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

function headersToPgn(headers: GameHeaders): string[] {
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
  return lines;
}

function escapeHeader(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function createRootNode(fen: string): MoveNode {
  return {
    id: ROOT_ID,
    parentId: null,
    san: null,
    uci: null,
    fenBefore: fen,
    fenAfter: fen,
    ply: 0,
    nags: [],
    comment: null,
    clockAfter: null,
    arrows: [],
    highlights: [],
    children: []
  };
}

/** Latest remaining times on the path from root to `nodeId`, from `[%clk]` on each move. */
export function clocksOnPathToNode(moveTree: MoveNode[], nodeId: string): {
  white: string | null;
  black: string | null;
} {
  const path: MoveNode[] = [];
  let id: string | null = nodeId;
  while (id) {
    const node = moveTree.find((n) => n.id === id);
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
