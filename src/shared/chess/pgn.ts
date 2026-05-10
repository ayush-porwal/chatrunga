import { nanoid } from "nanoid";
import { parsePgn, startingPosition } from "chessops/pgn";
import type { ChildNode, PgnNodeData } from "chessops/pgn";
import { makeFen } from "chessops/fen";
import { parseAnnotationComment, serializeAnnotationComment } from "./annotations";
import { applySan, START_FEN } from "./position";
import type { GameHeaders, GameSession, ImportedGame, MoveNode } from "../types/chess";

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

  const mainline = [...game.moves.mainline()];
  let currentNodeId = ROOT_ID;
  if (mainline.length) {
    let cursor = ROOT_ID;
    for (const child of game.moves.mainlineNodes()) {
      const node = moveTree.find((item) => item.parentId === cursor && item.san === child.data.san);
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

function appendPgnChild(
  moveTree: MoveNode[],
  parentId: string,
  fenBefore: string,
  ply: number,
  child: ChildNode<PgnNodeData>
): void {
  const applied = applySan(fenBefore, child.data.san);
  if (!applied) return;
  const comments = child.data.comments ?? [];
  const annotation = parseAnnotationComment(comments.join(" "));
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
    const comment = serializeAnnotationComment(node.comment, node.arrows, node.highlights);
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
  return {
    event: headers.get("Event") ?? null,
    site: headers.get("Site") ?? null,
    date: headers.get("Date") ?? null,
    round: headers.get("Round") ?? null,
    white: headers.get("White") ?? null,
    black: headers.get("Black") ?? null,
    result: headers.get("Result") ?? "*"
  };
}

function headersToPgn(headers: GameHeaders): string[] {
  const values = {
    Event: headers.event || "?",
    Site: headers.site || "?",
    Date: headers.date || "????.??.??",
    Round: headers.round || "?",
    White: headers.white || "White",
    Black: headers.black || "Black",
    Result: headers.result || "*"
  };
  return Object.entries(values).map(([key, value]) => `[${key} "${escapeHeader(value)}"]`);
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
    arrows: [],
    highlights: [],
    children: []
  };
}
